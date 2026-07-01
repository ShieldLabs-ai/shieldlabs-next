/**
 * @shieldlabs/next — Next.js integration for the ShieldLabs browser loader.
 * Re-exports the React bindings and adds a <ShieldLabsScript /> helper.
 * No signal-collection logic lives here.
 *
 * Status: pre-launch scaffold. Surface is a placeholder.
 */
export type { IdentificationResult, ShieldLabsOptions } from "@shieldlabs/js";
export { useShieldLabs } from "@shieldlabs/react";
