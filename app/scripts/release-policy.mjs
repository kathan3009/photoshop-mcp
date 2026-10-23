// Pure release policy, kept separate so failure paths can be tested without credentials.
export function releasePolicy({ local, env, identities }) {
  if (local) return { identity: '-', hardenedRuntime: false, notarize: false };
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') {
    throw new Error('Public builds require signing; unset CSC_IDENTITY_AUTO_DISCOVERY=false.');
  }
  if (!env.CSC_LINK && !identities.includes('Developer ID Application:')) {
    throw new Error('No Developer ID Application certificate found. Import your certificate with its private key, or use npm run dist:local for an unnotarized test build.');
  }
  const credentials = env.APPLE_KEYCHAIN_PROFILE ||
    (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) ||
    (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER);
  if (!credentials) throw new Error('Notarization credentials missing. Set APPLE_KEYCHAIN_PROFILE to a notarytool profile; see docs/RELEASING.md.');
  return { hardenedRuntime: true, notarize: true };
}

export function artifactName(version, arch, local) {
  return `Photoshop-MCP-${version}-${arch}${local ? '-unnotarized' : ''}.dmg`;
}
