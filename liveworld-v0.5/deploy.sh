#!/usr/bin/env bash
set -euo pipefail
DEST=/var/www/liveword/public
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo mkdir -p "$DEST"
sudo rsync -a --delete "$SCRIPT_DIR/public/" "$DEST/"
sudo chown -R www-data:www-data /var/www/liveword
sudo find /var/www/liveword -type d -exec chmod 755 {} \;
sudo find /var/www/liveword -type f -exec chmod 644 {} \;
echo "LIVEWORLD v0.5 copied to $DEST"
echo "IMPORTANT: v0.5 requests CelesTrak GROUP=ACTIVE. Configure the 2-hour Nginx cache in nginx/ before production use."
echo "Then run: sudo nginx -t && sudo systemctl reload nginx"
