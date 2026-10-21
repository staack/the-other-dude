#!/usr/bin/env bash
# Try the public Docker Hub cache explicitly; retain canonical local image names.
# Cache misses fall back to Docker Hub because Google's cache is not exhaustive.
set -euo pipefail
for image in "$@"; do
  if docker image inspect "$image" >/dev/null 2>&1; then
    continue
  fi
  repository="$image"
  if [[ "$repository" != */* ]]; then
    repository="library/$repository"
  fi
  cached="mirror.gcr.io/$repository"
  if docker pull "$cached"; then
    docker tag "$cached" "$image"
  else
    docker pull "$image"
  fi
done
