//! Mint extension validation.
//!
//! We reject mints that carry extensions incompatible with a staking vault:
//!
//! - **TransferHook**: arbitrary code on every transfer could block unstaking.
//! - **PermanentDelegate**: a third party could drain the vault at any time.
//! - **NonTransferable**: tokens can't be staked/unstaked if non-transferable.
//! - **DefaultAccountState = Frozen**: new ATAs start frozen, blocking operations.
//! - **ConfidentialTransfer**: balance-delta accounting becomes impossible with
//!   encrypted amounts.
//!
//! Legacy SPL Token mints have no extensions and always pass.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::spl_token_2022::{
    extension::{BaseStateWithExtensions, StateWithExtensions},
    state::Mint as MintState,
};

use crate::error::StakingError;

/// Validate that a mint account does not carry dangerous extensions.
///
/// For legacy SPL Token mints (data len = 82), this always succeeds.
/// For Token-2022 mints, we parse extensions and reject the dangerous ones.
pub fn validate_mint_extensions(mint_data: &[u8]) -> Result<()> {
    // Legacy SPL Token mints are exactly 82 bytes. No extensions possible.
    if mint_data.len() <= 82 {
        return Ok(());
    }

    // Token-2022 mint: parse extensions.
    let mint_state = StateWithExtensions::<MintState>::unpack(mint_data)
        .map_err(|_| error!(StakingError::TransferHookNotAllowed))?;

    // TransferHook
    if mint_state
        .get_extension::<anchor_spl::token_interface::spl_token_2022::extension::transfer_hook::TransferHook>()
        .is_ok()
    {
        return Err(error!(StakingError::TransferHookNotAllowed));
    }

    // PermanentDelegate
    if mint_state
        .get_extension::<anchor_spl::token_interface::spl_token_2022::extension::permanent_delegate::PermanentDelegate>()
        .is_ok()
    {
        return Err(error!(StakingError::PermanentDelegateNotAllowed));
    }

    // NonTransferable
    if mint_state
        .get_extension::<anchor_spl::token_interface::spl_token_2022::extension::non_transferable::NonTransferable>()
        .is_ok()
    {
        return Err(error!(StakingError::NonTransferableNotAllowed));
    }

    // DefaultAccountState
    if let Ok(ext) = mint_state
        .get_extension::<anchor_spl::token_interface::spl_token_2022::extension::default_account_state::DefaultAccountState>()
    {
        let state: anchor_spl::token_interface::spl_token_2022::state::AccountState =
            ext.state.try_into().unwrap_or(anchor_spl::token_interface::spl_token_2022::state::AccountState::Frozen);
        if state == anchor_spl::token_interface::spl_token_2022::state::AccountState::Frozen {
            return Err(error!(StakingError::DefaultAccountStateFrozenNotAllowed));
        }
    }

    // ConfidentialTransfer
    if mint_state
        .get_extension::<anchor_spl::token_interface::spl_token_2022::extension::confidential_transfer::ConfidentialTransferMint>()
        .is_ok()
    {
        return Err(error!(StakingError::ConfidentialTransferNotAllowed));
    }

    Ok(())
}
