// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {StakingPool} from "./StakingPool.sol";

/// @title StakingFactory
/// @notice Deploys one isolated `StakingPool` per ERC-20 token.
///
/// Launch fee (per tier) is priced in the same transaction:
/// 1. Holder discount from `MEMBERSHIP_TOKEN` balance (0–30%).
/// 2. Direct referral: 10–30% of the discounted fee. The first referrer is
///    saved on the launcher and is paid on every later launch, even if a
///    different referrer is passed or none is.
/// 3. Indirect override: 5% of the direct commission, pull-paid to the
///    referrer's bound parent (`referredBy[referrer]`). Hop 3 is 2% of that.
/// 4. Remainder goes to `FEE_RECIPIENT`.
contract StakingFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Tier {
        Bronze,
        Ecosystem,
        Marketing
    }

    uint256 public immutable BRONZE_FEE;
    uint256 public immutable ECOSYSTEM_FEE;
    uint256 public immutable MARKETING_FEE;
    address public immutable FEE_RECIPIENT;
    /// Token whose balance discounts the launch fee. Zero ⇒ no holder discount.
    address public immutable MEMBERSHIP_TOKEN;

    uint256 public constant BRONZE_MAX_DURATION_DAYS = 2;
    uint256 public constant MAX_TAX_BPS = 1_000;
    uint256 public constant MIN_DURATION_DAYS = 1;
    uint256 public constant MAX_DURATION_DAYS = 30;
    uint256 public constant BPS_DENOM = 10_000;

    uint256 public constant REF_MIN_BPS = 1_000; // 10%
    uint256 public constant REF_MAX_BPS = 3_000; // 30%
    uint256 public constant REF_STEP_BPS = 100; // +1% per referred launch
    uint256 public constant REF_STEP_CAP = 20;
    uint256 public constant INDIRECT_BPS = 500; // hop 2: 5% of the direct commission
    uint256 public constant HOP3_BPS = 200; // hop 3: 2% of hop-2, then hard cap

    constructor(
        uint256 bronzeFee,
        uint256 ecosystemFee,
        uint256 marketingFee,
        address feeRecipient,
        address membershipToken
    ) {
        if (bronzeFee == 0) revert ZeroFee();
        if (!(bronzeFee < ecosystemFee && ecosystemFee < marketingFee)) revert BadFeeOrder();
        if (feeRecipient == address(0)) revert ZeroAddress();
        if (feeRecipient == msg.sender) revert FeeRecipientIsDeployer();
        BRONZE_FEE = bronzeFee;
        ECOSYSTEM_FEE = ecosystemFee;
        MARKETING_FEE = marketingFee;
        FEE_RECIPIENT = feeRecipient;
        MEMBERSHIP_TOKEN = membershipToken;
    }

    mapping(address => address) public poolOf;
    address[] public allPools;
    mapping(address => uint256) public referralCount;
    mapping(address => uint256) public owedToReferrer;
    mapping(address => uint256) public lifetimeEarned;
    /// Set once. The parent who earns the hop-2 override when this address is the direct referrer.
    mapping(address => address) public referredBy;
    mapping(address => address[]) private _directs;
    mapping(address => mapping(address => uint256)) public earnedFrom;
    /// Hop-2 fees `beneficiary` has received from `launcher` (an indirect under a direct).
    mapping(address => mapping(address => uint256)) public hop2Earned;

    function feeForTier(Tier tier) public view returns (uint256) {
        if (tier == Tier.Bronze) return BRONZE_FEE;
        if (tier == Tier.Ecosystem) return ECOSYSTEM_FEE;
        return MARKETING_FEE;
    }

    function holderBalanceWhole(address account) public view returns (uint256) {
        address token = MEMBERSHIP_TOKEN;
        if (token == address(0) || token.code.length == 0) return 0;
        uint256 raw = IERC20(token).balanceOf(account);
        uint8 dec = IERC20Metadata(token).decimals();
        if (dec == 0) return raw;
        return raw / (10 ** uint256(dec));
    }

    function holderDiscountBps(address account) public view returns (uint256) {
        uint256 w = holderBalanceWhole(account);
        if (w >= 10_000_000) return 3_000;
        if (w >= 1_000_000) return 2_000;
        if (w >= 100_000) return 1_000;
        if (w >= 10_000) return 500;
        return 0;
    }

    function referralCommissionBps(uint256 referredCount) public pure returns (uint256) {
        uint256 extra = referredCount >= REF_STEP_CAP ? REF_STEP_CAP : referredCount;
        return REF_MIN_BPS + extra * REF_STEP_BPS;
    }

    function directsOf(address referrer) external view returns (address[] memory) {
        return _directs[referrer];
    }

    function directsCount(address referrer) external view returns (uint256) {
        return _directs[referrer].length;
    }

    function quoteLaunchFee(address launcher, Tier tier) public view returns (uint256) {
        uint256 base = feeForTier(tier);
        uint256 disc = holderDiscountBps(launcher);
        return base - (base * disc) / BPS_DENOM;
    }

    function quoteLaunch(address launcher, Tier tier, address referrer)
        public
        view
        returns (
            uint256 baseFee,
            uint256 discountBps,
            uint256 userPays,
            address referrerUsed,
            uint256 commissionBps,
            uint256 commission,
            address indirectUsed,
            uint256 indirectAmount,
            address hop3Used,
            uint256 hop3Amount,
            uint256 protocolReceives
        )
    {
        baseFee = feeForTier(tier);
        discountBps = holderDiscountBps(launcher);
        userPays = baseFee - (baseFee * discountBps) / BPS_DENOM;
        referrerUsed = _resolveReferrer(launcher, referrer);
        if (referrerUsed != address(0)) {
            commissionBps = referralCommissionBps(referralCount[referrerUsed]);
            commission = (userPays * commissionBps) / BPS_DENOM;
            address parent = referredBy[referrerUsed];
            if (_eligibleHop(parent, launcher, referrerUsed, address(0))) {
                indirectUsed = parent;
                indirectAmount = (commission * INDIRECT_BPS) / BPS_DENOM;
                address grand = referredBy[parent];
                if (_eligibleHop(grand, launcher, referrerUsed, parent)) {
                    hop3Used = grand;
                    hop3Amount = (indirectAmount * HOP3_BPS) / BPS_DENOM;
                }
            }
        }
        protocolReceives = userPays - commission - indirectAmount - hop3Amount;
    }

    event PoolCreated(
        address indexed token,
        address indexed pool,
        address indexed operator,
        address treasury,
        uint256 durationDays,
        uint256 stakeTaxBps,
        uint256 unstakeTaxBps,
        uint256 fundingAmount,
        uint256 minStake,
        Tier tier
    );
    event LaunchPriced(
        address indexed launcher,
        address indexed referrer,
        address indexed indirect,
        address hop3,
        uint256 paid,
        uint256 commission,
        uint256 indirectAmount,
        uint256 hop3Amount
    );
    event ReferralAccrued(address indexed referrer, uint256 amount, uint256 newCount);
    event IndirectAccrued(address indexed parent, address indexed direct, address indexed launcher, uint256 amount);
    event Hop3Accrued(address indexed hop3, address indexed hop2, address indexed launcher, uint256 amount);
    event ReferrerBound(address indexed account, address indexed parent);
    event ReferralClaimed(address indexed referrer, uint256 amount);

    error PoolExists();
    error ZeroAddress();
    error BadLaunchFee();
    error TaxTooHigh();
    error TaxWithoutTreasury();
    error BadDuration();
    error FeeTransferFailed();
    error ZeroFunding();
    error BadFeeOrder();
    error ZeroFee();
    error FeeRecipientIsDeployer();
    error ZeroMinStake();
    error NothingOwed();

    function createPool(
        IERC20 token,
        address treasury,
        uint256 durationDays,
        uint256 stakeTaxBps,
        uint256 unstakeTaxBps,
        uint256 fundingAmount,
        uint256 minStake,
        Tier tier
    ) external payable nonReentrant returns (address pool) {
        pool = _deployPool(token, treasury, durationDays, stakeTaxBps, unstakeTaxBps, fundingAmount, minStake, tier);
        _takeLaunchFee(tier, address(0));
    }

    function createPoolReferred(
        IERC20 token,
        address treasury,
        uint256 durationDays,
        uint256 stakeTaxBps,
        uint256 unstakeTaxBps,
        uint256 fundingAmount,
        uint256 minStake,
        Tier tier,
        address referrer
    ) external payable nonReentrant returns (address pool) {
        pool = _deployPool(token, treasury, durationDays, stakeTaxBps, unstakeTaxBps, fundingAmount, minStake, tier);
        _takeLaunchFee(tier, referrer);
    }

    function claimReferral() external nonReentrant {
        uint256 amount = owedToReferrer[msg.sender];
        if (amount == 0) revert NothingOwed();
        owedToReferrer[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert FeeTransferFailed();
        emit ReferralClaimed(msg.sender, amount);
    }

    function _deployPool(
        IERC20 token,
        address treasury,
        uint256 durationDays,
        uint256 stakeTaxBps,
        uint256 unstakeTaxBps,
        uint256 fundingAmount,
        uint256 minStake,
        Tier tier
    ) internal returns (address pool) {
        if (address(token) == address(0)) revert ZeroAddress();
        if (fundingAmount == 0) revert ZeroFunding();
        if (minStake == 0) revert ZeroMinStake();
        if (durationDays < MIN_DURATION_DAYS || durationDays > MAX_DURATION_DAYS) revert BadDuration();
        if (tier == Tier.Bronze && durationDays > BRONZE_MAX_DURATION_DAYS) revert BadDuration();

        address existing = poolOf[address(token)];
        if (existing != address(0) && !_hasEnded(existing)) revert PoolExists();

        if (stakeTaxBps > MAX_TAX_BPS || unstakeTaxBps > MAX_TAX_BPS) revert TaxTooHigh();
        if (treasury == address(0) && (stakeTaxBps != 0 || unstakeTaxBps != 0)) {
            revert TaxWithoutTreasury();
        }

        uint8 dec = IERC20Metadata(address(token)).decimals();
        StakingPool p = new StakingPool(
            token,
            msg.sender,
            msg.sender,
            treasury,
            dec,
            durationDays,
            stakeTaxBps,
            unstakeTaxBps,
            minStake,
            uint8(tier)
        );
        pool = address(p);
        poolOf[address(token)] = pool;
        allPools.push(pool);
        token.safeTransferFrom(msg.sender, pool, fundingAmount);
        StakingPool(pool).initializeFunded(fundingAmount);
        emit PoolCreated(
            address(token),
            pool,
            msg.sender,
            treasury,
            durationDays,
            stakeTaxBps,
            unstakeTaxBps,
            fundingAmount,
            minStake,
            tier
        );
    }

    function _takeLaunchFee(Tier tier, address referrer) internal {
        uint256 paid = quoteLaunchFee(msg.sender, tier);
        if (msg.value != paid) revert BadLaunchFee();

        address direct = _resolveReferrer(msg.sender, referrer);
        uint256 comm;
        uint256 hop2Amt;
        uint256 hop3Amt;
        address hop2;
        address hop3;

        if (direct != address(0)) {
            comm = (paid * referralCommissionBps(referralCount[direct])) / BPS_DENOM;
            owedToReferrer[direct] += comm;
            lifetimeEarned[direct] += comm;
            if (earnedFrom[direct][msg.sender] == 0) {
                _directs[direct].push(msg.sender);
            }
            earnedFrom[direct][msg.sender] += comm;
            uint256 n = referralCount[direct] + 1;
            referralCount[direct] = n;
            emit ReferralAccrued(direct, comm, n);

            // Written only after this create succeeds with someone else's link.
            if (referredBy[msg.sender] == address(0)) {
                referredBy[msg.sender] = direct;
                emit ReferrerBound(msg.sender, direct);
            }

            hop2 = referredBy[direct];
            if (_eligibleHop(hop2, msg.sender, direct, address(0))) {
                hop2Amt = (comm * INDIRECT_BPS) / BPS_DENOM;
                if (hop2Amt > 0) {
                    owedToReferrer[hop2] += hop2Amt;
                    lifetimeEarned[hop2] += hop2Amt;
                    hop2Earned[hop2][msg.sender] += hop2Amt;
                    emit IndirectAccrued(hop2, direct, msg.sender, hop2Amt);
                }
                hop3 = referredBy[hop2];
                if (_eligibleHop(hop3, msg.sender, direct, hop2)) {
                    hop3Amt = (hop2Amt * HOP3_BPS) / BPS_DENOM;
                    if (hop3Amt > 0) {
                        owedToReferrer[hop3] += hop3Amt;
                        lifetimeEarned[hop3] += hop3Amt;
                        emit Hop3Accrued(hop3, hop2, msg.sender, hop3Amt);
                    }
                }
            }
        }

        emit LaunchPriced(msg.sender, direct, hop2, hop3, paid, comm, hop2Amt, hop3Amt);

        uint256 proto = paid - comm - hop2Amt - hop3Amt;
        if (proto > 0) {
            (bool ok,) = FEE_RECIPIENT.call{value: proto}("");
            if (!ok) revert FeeTransferFailed();
        }
    }

    /// Saved parent wins. A later link, or no link, cannot replace them.
    function _resolveReferrer(address launcher, address referrer) internal view returns (address) {
        address bound = referredBy[launcher];
        if (bound != address(0) && bound != launcher) return bound;
        if (referrer == address(0) || referrer == launcher) return address(0);
        return referrer;
    }

    function _eligibleHop(address candidate, address launcher, address hop1, address hop2)
        internal
        pure
        returns (bool)
    {
        return candidate != address(0) && candidate != launcher && candidate != hop1 && candidate != hop2;
    }

    function _hasEnded(address poolAddr) internal view returns (bool) {
        uint256 end = StakingPool(poolAddr).endTs();
        return end != 0 && block.timestamp >= end;
    }

    function poolCount() external view returns (uint256) {
        return allPools.length;
    }
}
