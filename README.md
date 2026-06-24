# PT Barbershop POS

Bo web order/barbershop POS cho PT Barbershop.

## Tai khoan

- Admin: `9939` / `040426`
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

## Cai thanh app tren iPhone/Android

Ban web nay da duoc cau hinh nhu app PWA:

- Android: mo link HTTPS tren Chrome, bam nut `Cai app` trong web hoac menu Chrome -> `Cai dat ung dung`.
- iPhone: mo link HTTPS bang Safari, bam nut Chia se, chon `Them vao Man hinh chinh`.
- Sau khi cai, man hinh dien thoai se co icon `PT Barber` va mo toan man hinh nhu app.
- Day la cach mien phi, khong can tai khoan App Store hoac CH Play.

## Neu can nhap thu cong tren Render

Chon `New +` -> `Web Service`:

- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`

Sau do tao Postgres tren Render va gan bien moi truong `DATABASE_URL` cho Web Service.

## Sao luu du lieu

Khi deploy dung voi database, du lieu luu online va cac may se thay chung. Van nen sao luu dinh ky:

1. Dang nhap Admin hoac Quan Li.
2. Vao `Dau ca / Ket ca`.
3. Bam `Tai file sao luu`.
4. Qua may moi, mo web va dang nhap Admin hoac Quan Li.
5. Vao `Dau ca / Ket ca`.
6. Bam `Nhap file sao luu`.

Neu dau trang hien `Dong bo: Luu tren may nay`, backend/database chua ket noi nen du lieu tam thoi chi nam tren may do.

## Admin quan ly tai khoan

- Dang nhap Admin bang `9939` / `040426`.
- Vao tab `Tai khoan`.
- Co the tim theo ID, ten bo/chi nhanh hoac vai tro.
- Co the tao khong gioi han bo tai khoan/chi nhanh, sua ID/mat khau va xoa bo tai khoan khac.
- Co nut `Tao ID tu dong cho chi nhanh moi` de he thong tu dien ID Quan Li, ID Thu Ngan va mat khau mau.
- Dieu kien duy nhat la ID khong duoc trung nhau trong toan he thong.
- Khong xoa duoc bo tai khoan dang dang nhap.
- Moi bo tai khoan co bill, doanh thu, dau ca/ket ca va nhan vien rieng.
- Bo 1 va bo 2 khong anh huong doanh thu cua nhau.
- Khi dung Render Web Service + Postgres, ID vua tao co the dang nhap tren may tinh/iPhone khac.
- Neu dang chay offline/local, ID moi chi luu tren thiet bi dang tao.

## Hoa don

- Moi bill da luu co So HD, vi du `HD000001`.
- STT cho la so thu tu khach doi cat trong ca hien tai.
- Co the nhap so dien thoai khach va phuong thuc thanh toan khi tao bill.
- Lich su bill co o tim So HD, STT, ten khach, so dien thoai, nhan vien hoac phuong thuc thanh toan.
- Thu Ngan huy bill chi can nhap ly do. He thong gui yeu cau den Quan Li/Admin de duyet hoac tu choi tren tai khoan dang nhap cua ho.
- Nut yeu cau huy dung form ngay trong app, hoat dong on dinh tren iPhone/Android va khong bao gio hoi ID/mat khau Quan Li.
- Thu Ngan khong xem duoc chi tiet huy bill; chi Quan Li moi xem duoc.
- Khi dung Render + Postgres va co Internet, yeu cau huy se tu dong hien tren thiet bi dang dang nhap Quan Li/Admin. Thu Ngan khong can biet hoac nhap mat khau Quan Li.

## In bill tinh tien

- He thong chi co 1 nut chinh: `In bill`.
- Bam nut `In bill` se luu hoa don vao he thong truoc, tao So HD/STT, tinh doanh thu, tinh tien chia tho va in bill day du.
- Tho chi lam theo bill da duoc in tu nut nay.
- Sau khi da in bill, hoa don nam trong lich su bill va khong the xoa.

## Chong da bill

- Bill da luu duoc khoa: khong co sua bill va khong co xoa bill.
- Nut `In bill` se luu hoa don vao he thong truoc roi moi in, khong con in hoa don nhap.
- Sau khi da in/luu, `Xoa dich vu` chi xoa bill dang soan moi, khong xoa duoc hoa don da luu.
- Thu Ngan muon huy bill chi nhap ly do; khong can va khong duoc nhap ID/mat khau Quan Li.
- Quan Li xem duoc `Nhat ky chong da bill` trong tab `Dau ca / Ket ca`.
- Nhat ky ghi lai luu bill, huy bill, mo ca, ket ca va khoi phuc du lieu.
- Neu chay bang Render Web Service + Postgres, server se chan Thu Ngan neu co tinh xoa bill, sua bill cu, sua bang gia/nhan vien hoac huy bill truc tiep. Thu Ngan chi duoc tao yeu cau huy bill dang cho Quan Li/Admin duyet.

## Thanh toan

- Ho tro `Tien mat`, `Chuyen khoan`, `The`, `Khac`.
- Doanh thu hop le tinh tat ca phuong thuc.
- Tien du kien trong ket chi tinh `Tien dau ca + bill Tien mat`.
- Bill chuyen khoan/the/khac van tinh doanh thu nhung khong lam tang tien mat trong ket.

## Ket ca

- Sau Ket ca, man hinh bill cua ca dang lam tro ve trong de bat dau ca moi gon gang. Du lieu bill/ket ca cu van nam trong Excel, database va file sao luu da khoa.
- Nut `Ket ca` se chot ca va dua doanh thu ca hien tai ve 0.
- Nut `In ket ca` se chot ca, in phieu ket ca, roi dua doanh thu ca hien tai ve 0.
- Neu da chot ca truoc do, `In ket ca` se in lai ca vua ket gan nhat.
- Phieu ket ca in ro doanh thu theo tien mat, chuyen khoan, the va khac.

## Bao cao Excel

- Admin va Quan Li co nut `Xuat Excel 30 ngay` trong tab `Dau ca / Ket ca`.
- File `.xlsx` co phong cach PT Barbershop, ten thuong hieu va chi nhanh dang dang nhap.
- File gom 4 tab: `Tong hop 30 ngay`, `Chi tiet bill`, `Chia tho theo ngay`, `Tong chia tung tho`.
- Chi tiet bill co so HD, khach, tho cat/lam, dich vu, thanh toan, doanh thu, % chia, tien chia va trang thai huy.
- Khi Admin/Quan Li bam `Ket ca`, doanh thu ca moi ve 0 va Excel chi tiet cua ca vua chot duoc tao san. Bam `Tai Excel ket ca` de luu file vao may.
- Bill va nhat ky bao mat van duoc khoa tren he thong sau Ket ca de giu chong da bill.

## Bao mat ban Render

- Password trong Postgres duoc bam scrypt; API khong tra password ve trinh duyet va man hinh Tai khoan khong hien password.
- Dang nhap online dung phien HttpOnly ky so; dong bo bill khong gui lai mat khau.
- Co gioi han dang nhap sai, Content Security Policy, cac security header trinh duyet va kiem soat quyen tren server.
- Ban mo truc tiep/offline van huu ich de du phong, nhung khong the an toan bang Render Web Service + Postgres vi khong co server de xac thuc va chong sua du lieu.
