#!/usr/bin/env bash
set -euo pipefail
DEST=/var/www/liveword/public
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo mkdir -p "$DEST"
sudo cp "$SCRIPT_DIR/public/index.html" "$SCRIPT_DIR/public/styles.css" "$SCRIPT_DIR/public/app.js" "$DEST/"
sudo chown -R www-data:www-data /var/www/liveword
sudo find /var/www/liveword -type d -exec chmod 755 {} \;
sudo find /var/www/liveword -type f -exec chmod 644 {} \;
echo "Frontend copied to $DEST"
echo "Now merge nginx/liveword.conf.example into /etc/nginx/sites-available/liveword, then run:"
echo "  sudo nginx -t && sudo systemctl reload nginx"
