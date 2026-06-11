# PT Barbershop POS

Bo web order/barbershop POS cho PT Barbershop.

## Tai khoan

- Quan Li: `9939` / `040426`
- Thu Ngan: `3122` / `152004`

## Deploy len Render co dong bo online

Ban dong bo online can Render Web Service + Postgres. Nen dung Blueprint.

### Cach dung: Blueprint

1. Day toan bo thu muc nay len GitHub.
2. Vao Render.
3. Chon `New +` -> `Blueprint`.
4. Chon repo GitHub vua tao.
5. Bam `Apply`.

Render se doc file `render.yaml` san co va tao:

- Web Service: `pt-barbershop-pos`
- Database: `pt-barbershop-db`

Khong chon `Static Site` neu muon may tinh/iPhone tu dong dong bo.

## Neu can nhap thu cong tren Render

Chon `New +` -> `Web Service`:

- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`

Sau do tao Postgres tren Render va gan bien moi truong `DATABASE_URL` cho Web Service.

## Sao luu du lieu

Khi deploy dung voi database, du lieu luu online va cac may se thay chung. Van nen sao luu dinh ky:

1. Dang nhap Quan Li.
2. Vao `Dau ca / Ket ca`.
3. Bam `Tai file sao luu`.
4. Qua may moi, mo web va dang nhap Quan Li.
5. Vao `Dau ca / Ket ca`.
6. Bam `Nhap file sao luu`.

Neu dau trang hien `Dong bo: Luu tren may nay`, backend/database chua ket noi nen du lieu tam thoi chi nam tren may do.

## Hoa don

- Moi bill da luu co So HD, vi du `HD000001`.
- STT cho la so thu tu khach doi cat trong ca hien tai.
- Lich su bill co o tim So HD.
- Khi huy bill da luu phai nhap ly do.
- Thu Ngan khong xem duoc chi tiet huy bill; chi Quan Li moi xem duoc.

## Ket ca

- Nut `Ket ca` se chot ca va dua doanh thu ca hien tai ve 0.
- Nut `In ket ca` se chot ca, in phieu ket ca, roi dua doanh thu ca hien tai ve 0.
- Neu da chot ca truoc do, `In ket ca` se in lai ca vua ket gan nhat.
