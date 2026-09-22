# LIVEWORLD — deploy-ready static globe

Bản này KHÔNG dùng Vite, KHÔNG npm install, KHÔNG build trên server.
Nginx serve 3 file frontend trực tiếp. Three.js + satellite.js được browser tải từ jsDelivr bằng import map.
Nginx proxy CelesTrak qua same-origin `/api/celestrak/` để tránh CORS.

## 1) Copy frontend

```bash
sudo mkdir -p /var/www/liveword/public
sudo cp public/index.html public/styles.css public/app.js /var/www/liveword/public/
sudo chown -R www-data:www-data /var/www/liveword
sudo find /var/www/liveword -type d -exec chmod 755 {} \;
sudo find /var/www/liveword -type f -exec chmod 644 {} \;
```

## 2) Sửa Nginx

Mở file hiện tại:

```bash
sudo nano /etc/nginx/sites-available/liveword
```

Trong `server { ... }` HTTPS hiện có, đảm bảo có:

```nginx
root /var/www/liveword/public;
index index.html;

location / {
    try_files $uri $uri/ /index.html;
}

location /api/celestrak/ {
    proxy_ssl_server_name on;
    proxy_set_header Host celestrak.org;
    proxy_set_header User-Agent "LIVEWORLD/0.3 (+https://liveword.longh.org)";
    proxy_pass https://celestrak.org/NORAD/elements/;
    proxy_connect_timeout 10s;
    proxy_read_timeout 30s;
}
```

GIỮ NGUYÊN các dòng `listen 443 ssl`, `ssl_certificate`, `ssl_certificate_key` do Certbot tạo.

Sau đó:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 3) Test từng lớp trước khi mở browser

```bash
curl -I https://liveword.longh.org/
curl 'https://liveword.longh.org/api/celestrak/gp.php?GROUP=STATIONS&FORMAT=JSON' | head -c 300
```

Lệnh thứ hai phải trả JSON có `OBJECT_NAME`, `NORAD_CAT_ID`, ...

Sau đó mở Chrome và hard refresh: `Ctrl+Shift+R`.

## Nếu vẫn trắng

Chrome → F12 → Console. Bản này cũng có hộp lỗi ngay trên màn hình nếu app.js hoặc CDN không load.

Kiểm tra:

```bash
curl -I https://liveword.longh.org/app.js
curl -I https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js
```

## Lưu ý

V0.3 này tải `STATIONS` và `GPS-OPS`; vị trí được propagate tại browser bằng SGP4. Chưa bật aircraft/ship thật. Các nút Air/Sea hiện bị disable có chủ ý.
