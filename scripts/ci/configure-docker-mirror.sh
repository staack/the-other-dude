#!/usr/bin/env bash
# Hosted CI runners only. Preserve daemon options and fall back to Docker Hub
# when an image is absent from Google's public pull-through cache.
set -euo pipefail
sudo python3 - <<'PY'
import json
from pathlib import Path
path = Path('/etc/docker/daemon.json')
config = json.loads(path.read_text()) if path.exists() else {}
mirrors = config.get('registry-mirrors', [])
mirror = 'https://mirror.gcr.io'
config['registry-mirrors'] = [mirror, *[value for value in mirrors if value != mirror]]
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(config, indent=2) + '\n')
PY
sudo systemctl restart docker
docker info --format '{{json .RegistryConfig.Mirrors}}'
