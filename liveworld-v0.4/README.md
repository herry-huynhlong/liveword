# LIVEWORLD v0.4 — Real Earth foundation

Bản này đổi renderer từ một sphere Three.js tự dựng sang **CesiumJS 1.145** để đúng với hướng sản phẩm: Earth là giao diện địa lý thực, camera có thể đi từ không gian xuống gần mặt đất, và mọi phương tiện là entity/billboard theo tọa độ WGS84.

## Có gì mới

- Earth WGS84 3D bằng CesiumJS.
- Blue Marble 5400×2700 được bundle local làm fallback nên globe vẫn có texture nếu imagery ngoài lỗi.
- Thử tải ArcGIS World Imagery để có tile ảnh vệ tinh chi tiết khi zoom gần; nếu lỗi thì tự rơi về Blue Marble.
- Bật ánh sáng Mặt Trời + atmosphere của Cesium.
- Camera collision/minimum zoom để không chui xuyên vào lòng Trái Đất.
- LOD theo độ cao camera: ở gần mặt đất sẽ ẩn orbital clutter, chuẩn bị cho Air/Sea/Rail/Launch.
- Vệ tinh dùng icon satellite thật.
- ISS/CSS dùng icon space station.
- Dragon/Cygnus/Soyuz/Progress/Tianzhou/Shenzhou dùng icon spacecraft.
- Debris dùng icon debris riêng.
- Click object mới bung panel dữ liệu.
- Hover object chỉ hiện tên.
- Follow / Show orbit vẫn hoạt động.
- CelesTrak proxy path giữ nguyên `/api/celestrak/`.

## Deploy trên Ubuntu/Nginx hiện tại

```bash
unzip liveworld-v0.4.zip
cd liveworld-v0.4
chmod +x deploy.sh
./deploy.sh
sudo nginx -t
sudo systemctl reload nginx
```

Sau đó hard refresh trình duyệt: `Ctrl + Shift + R`.

Nếu server hiện tại đã lấy được JSON ở `/api/celestrak/gp.php?...` thì **không cần sửa lại Nginx proxy**.

## Test

```bash
curl -I https://liveword.longh.org/
curl -I https://liveword.longh.org/assets/earth-blue-marble.jpg
curl 'https://liveword.longh.org/api/celestrak/gp.php?GROUP=STATIONS&FORMAT=JSON' | head -c 200
```

## Ghi chú imagery

ArcGIS World Imagery hiện được dùng như lớp chi tiết online cho prototype. Trước khi đưa thành dịch vụ thương mại/lưu lượng lớn, cần kiểm tra điều khoản/giấy phép của imagery provider hoặc thay bằng provider/tile service mà bạn sở hữu quyền sử dụng. Blue Marble local là fallback, không phụ thuộc API key.

## Bước kế tiếp

Không đổi renderer nữa. Từ đây thêm data adapters vào cùng globe:

1. Aircraft ADS-B -> aircraft icon + heading/altitude.
2. Ship AIS -> ship icon + COG/SOG + predicted position.
3. Launch schedule/telemetry -> rocket icon + active trajectory.
4. Rail -> train icon khi có operator/GTFS realtime feed.
5. User/community location -> separate privacy-controlled entity layer.
