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
- Co the nhap so dien thoai khach va phuong thuc thanh toan khi tao bill.
- Lich su bill co o tim So HD, STT, ten khach, so dien thoai, nhan vien hoac phuong thuc thanh toan.
- Khi huy bill da luu phai nhap ly do va can ma Quan Li duyet.
- Thu Ngan khong xem duoc chi tiet huy bill; chi Quan Li moi xem duoc.

## Chong da bill

- Bill da luu duoc khoa: khong co sua bill va khong co xoa bill.
- Thu Ngan muon huy bill phai nhap ly do va ID/mat khau Quan Li.
- Quan Li xem duoc `Nhat ky chong da bill` trong tab `Dau ca / Ket ca`.
- Nhat ky ghi lai luu bill, huy bill, mo ca, ket ca va khoi phuc du lieu.
- Neu chay bang Render Web Service + Postgres, server se chan Thu Ngan neu co tinh xoa bill, sua bill cu, sua bang gia/nhan vien hoac huy bill khong co ma Quan Li.

## Thanh toan

- Ho tro `Tien mat`, `Chuyen khoan`, `The`, `Khac`.
- Doanh thu hop le tinh tat ca phuong thuc.
- Tien du kien trong ket chi tinh `Tien dau ca + bill Tien mat`.
- Bill chuyen khoan/the/khac van tinh doanh thu nhung khong lam tang tien mat trong ket.

## Ket ca

- Nut `Ket ca` se chot ca va dua doanh thu ca hien tai ve 0.
- Nut `In ket ca` se chot ca, in phieu ket ca, roi dua doanh thu ca hien tai ve 0.
- Neu da chot ca truoc do, `In ket ca` se in lai ca vua ket gan nhat.
- Phieu ket ca in ro doanh thu theo tien mat, chuyen khoan, the va khac.
