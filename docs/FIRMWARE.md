# Firmware upgrades

## Automatic extra-package downloads (9.11.0)

Start a device upgrade or staged fleet rollout from the Firmware page. No extra-package option or manual archive extraction is required. TOD inventories the device's installed packages and downloads the target RouterOS NPK plus matching extras from MikroTik's official `all_packages-{architecture}-{version}.zip` archive.

- Disabled installed packages are included. Packages listed as available but not installed are excluded.
- Downloads use the job's target version and device architecture. For example, an arm64 device with `routeros`, `container` and `wifi-qcom` receives all three NPKs for the target release.
- RouterOS 6 bundled subpackages are covered by the main bundle; separately installed packages retain their separate layout.
- TOD creates a mandatory configuration backup, validates the downloads and rechecks the package inventory before transferring files. A backup failure, missing required package, ambiguous inventory or changed inventory stops the job.
- Transfers reserve `/.tod-firmware-upgrade` and use temporary filenames that RouterOS will not install. TOD checks file sizes and promotes the complete set to NPK filenames before rebooting.
- After reconnecting, TOD requires the exact target RouterOS version and every originally installed package at that version before reporting success.

Upgrades can reboot the device. Use a maintenance window and review the job's failure message before retrying.

## Requirements and limits

The API needs outbound HTTPS access to MikroTik's download server and a writable firmware cache. The device credentials need access to package inventory, configuration backup, SFTP upload and reboot.

TOD refuses an upgrade when root-level NPK files or another staging reservation already exist. Inspect these files and any earlier job before retrying. A failed transfer attempts to remove its own staged files; incomplete cleanup is reported in the job error.

Resolve scheduled RouterOS package changes before starting a TOD upgrade. Cross-major package-layout migrations and upgrades crossing the RouterOS 7.13 wireless-package split require the RouterOS updater. TOD does not automatically choose replacement wireless drivers or add optional packages that were not installed.

MikroTik documents package installation and downgrade behavior in its [RouterOS package manual](https://help.mikrotik.com/docs/spaces/ROS/pages/40992872/Packages).

## Production cache mount

The production Compose API service mounts:

```yaml
volumes:
  - ./docker-data/firmware-cache:/data/firmware-cache
```

The host directory must be writable by the API container's UID 1001. The installer creates and assigns ownership to this directory. `FIRMWARE_CACHE_DIR` defaults to `/data/firmware-cache`; downloaded NPKs and extra-package archives are cached there.

For an existing installation, update the Compose files from v9.11.0 and recreate the API container using the same Compose files and environment file used for that installation. Pulling the new image alone does not add the mount. See [Deployment](DEPLOYMENT.md#storage-configuration) and [Configuration](CONFIGURATION.md#firmware).

## Verification in 9.11.0

Tests cover archive selection, corrupt or incomplete downloads, package inventories, transfer failures and post-reboot version checks. A real arm64 hAP ax³ was downgraded from 7.20.6 to 7.20.5 with `routeros`, `container` and `wifi-qcom`. The released TOD backend service then ran a PostgreSQL-backed upgrade job to 7.20.6: mandatory configuration backup, complete-package transfer, reboot, reconnect and exact package verification. The job reached `completed` in 74.33 seconds. Configuration commands matched the pre-test export; the backhaul reconnected and the body radio reported running with zero clients. Temporary test credentials were removed.

This exercised the backend job rather than the browser workflow. The harness used legacy encrypted credentials and the backup service's plaintext fallback with OpenBao unavailable; backups were kept in a restricted local directory. RouterOS 6 archive extraction was tested against the official 6.49.19/mipsbe archive; there was no live RouterOS 6 hardware test.
