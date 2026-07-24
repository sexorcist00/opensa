/** Local loader (plan 053): reads a user-picked raw GTA install folder into the VFS. Chromium-only. */
export { AssetHttpDirLoader } from './asset-http-dir-loader';
export { AssetLocalLoader, type AssetLocalLoaderConfig } from './asset-local-loader';
export type { InstallSource } from './build-vfs';
export { type DirIndexEntry, fetchDirIndex, fetchInstallSource } from './fetch-install-source';
