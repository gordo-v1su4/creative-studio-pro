#!/usr/bin/env bash
# Release the app to Hosted Studio's origin (the Docker service on the App VM).
# A push to main only redeploys the Vercel gateway; this is the other half.
#
#   scripts/release-studio.sh <commit>          release that commit
#   CSP_RELEASE_HOST=gordo@app-vm               where to release (default; Tailscale SSH)
#
# It archives the commit, copies it over, matches the checksum, builds the image there, keeps the running
# image as rollback-<its commit>, switches production and waits for healthy. It never touches data/.
# Afterwards, record the release in proxmox-home/docs/creative-studio-pro-hosting.md (the lines are printed).
set -euo pipefail

host="${CSP_RELEASE_HOST:-gordo@app-vm}"
dir=/opt/creative-studio-pro
[ $# -eq 1 ] || { echo "usage: scripts/release-studio.sh <commit>" >&2; exit 2; }
sha="$(git rev-parse --short=7 --verify "$1^{commit}")"
case "$sha" in *[!0-9a-f]*|"") echo "not a commit: $1" >&2; exit 2;; esac

git fetch -q origin
git merge-base --is-ancestor "$sha" origin/main || { echo "$sha is not on origin/main; push it first so the gateway and the app match" >&2; exit 1; }

work="$(mktemp -d)"
tar="$work/$sha.tar"
git archive --format=tar -o "$tar" "$sha"
sum="$(shasum -a 256 "$tar" | cut -d' ' -f1)"
echo "archive  $sha  sha256 $sum"

ssh -o BatchMode=yes "$host" "test ! -e $dir/releases/$sha" || { echo "$dir/releases/$sha already exists on $host; this commit was released before" >&2; exit 1; }
scp -q -o BatchMode=yes "$tar" "$host:$dir/releases/$sha.tar"

ssh -o BatchMode=yes -o ServerAliveInterval=30 "$host" bash -s -- "$sha" "$sum" "$dir" <<'REMOTE'
set -euo pipefail
sha="$1"; sum="$2"; dir="$3"
cd "$dir/releases"
[ "$(sha256sum "$sha.tar" | cut -d' ' -f1)" = "$sum" ] || { echo "checksum mismatch after transfer" >&2; exit 1; }
mkdir "$sha"
tar -xf "$sha.tar" -C "$sha"
image="$(cd "$sha" && sudo -n docker build -q -f infra/studio/Dockerfile -t "creative-studio-pro:$sha" .)"
# The running image keeps the tag of the commit it was built from; that commit names the rollback.
previous="$(sudo -n docker images creative-studio-pro --format '{{.Tag}} {{.ID}}' | awk -v id="$(sudo -n docker images -q creative-studio-pro:production)" '$2 == id && $1 ~ /^[0-9a-f]{7}$/ { print $1; exit }')"
[ -n "$previous" ] || previous="unknown-$(date +%Y%m%d%H%M%S)"
sudo -n docker tag creative-studio-pro:production "creative-studio-pro:rollback-$previous"
sudo -n docker tag "creative-studio-pro:$sha" creative-studio-pro:production
cd "$dir"
sudo -n docker compose up -d 2>&1 | tail -1
state=starting
for _ in $(seq 1 20); do
	state="$(sudo -n docker inspect -f '{{.State.Health.Status}}' creative-studio-pro)"
	[ "$state" = healthy ] && break
	sleep 6
done
anonymous="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18110/api/projects)"
echo "image    ${image#sha256:}" | cut -c1-21
echo "rollback rollback-$previous"
echo "health   $state"
echo "anonymous origin list  $anonymous"
[ "$state" = healthy ] && [ "$anonymous" = 401 ] || { echo "NOT HEALTHY: roll back with: sudo docker tag creative-studio-pro:rollback-$previous creative-studio-pro:production && sudo docker compose up -d" >&2; exit 1; }
REMOTE

echo "domain   $(curl -s -o /dev/null -w '%{http_code}' https://studio.v1su4.com/) (302 to sign-in when anonymous)"
echo "Released $sha. Now check it in a signed-in browser, then record it in proxmox-home/docs/creative-studio-pro-hosting.md."
