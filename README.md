# PT Barbershop POS

Bo web order/barbershop POS cho PT Barbershop.

## Website public va app POS

- Ten mien goc, vi du `https://ptbarbershop.site`, se mo web gioi thieu thuong hieu cho khach xem.
- Duong dan `/pos/`, vi du `https://ptbarbershop.site/pos/`, se mo app order/POS noi bo cho Thu Ngan, Quan Ly va Admin.
- API dong bo online van dung chung server, nen may tinh/iPhone dang nhap POS se cap nhat cung du lieu khi Render + Postgres hoat dong.
- Chi nhanh chinh mac dinh: Xa Hau Nghia, Tay Ninh. Quan Ly co the doi dia chi rieng cho tung chi nhanh trong phan thong tin in bill.

## Tai khoan

- Khong ghi ID/mat khau that trong GitHub.
- Ban Render lay tai khoan goc tu Environment Variables rieng tu:
  - `PT_ADMIN_ID`
  - `PT_ADMIN_PASSWORD`
  - `PT_CASHIER_ID`
  - `PT_CASHIER_PASSWORD`
- Ban offline mo truc tiep file `index.html` se cho tao Admin local lan dau bang ID/mat khau tu dat tren may do.

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

Sau khi Render tao service, vao `Environment` va nhap 4 bien `PT_ADMIN_ID`, `PT_ADMIN_PASSWORD`, `PT_CASHIER_ID`, `PT_CASHIER_PASSWORD` neu Render yeu cau. Khong dua cac gia tri nay vao README hoac code public.

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

- Dang nhap Admin bang ID/mat khau da dat trong Render Environment Variables.
- Vao tab `Tai khoan`.
- Co the tim theo ID, ten bo/chi nhanh hoac vai tro.
- Co the tao khong gioi han bo tai khoan/chi nhanh, sua ID/mat khau va xoa bo tai khoan khac.
- Co nut `Tao ID tu dong cho chi nhanh moi` de he thong tu dien ID Quan Li, ID Thu Ngan va mat khau mau.
- Dieu kien duy nhat la ID khong duoc trung nhau trong toan he thong.
- Khong xoa duoc bo tai khoan dang dang nhap.
- Moi bo tai khoan co bill, doanh thu, dau ca/ket ca va nhan vien rieng.
- Bo 1 va bo 2 khong anh huong doanh thu cua nhau.
- Khi dung Render Web Service + Postgres, ID vua tao co the dang nhap tren may tinh/iPhone khac.
- Admin dang mo tren nhieu may se tu cap nhat danh sach ID/chi nhanh moi tu server sau vai giay.
- Neu dang chay file offline du phong, ID moi chi luu tren thiet bi dang tao.
- Ban online se khong am tham tao tai khoan local khi server/database loi, de tranh may tinh thay ma dien thoai khong thay.

## Ten mien

- Link Render dang `*.onrender.com` dung duoc mien phi.
- Render mien phi phan gan custom domain va SSL/HTTPS cho web service.
- Ten mien rieng dep nhu `.com`, `.vn` thuong phai mua tu nha cung cap ten mien; neu chua mua thi dung link `onrender.com` truoc la on nhat.

## Hoa don

- Moi bill da luu co So HD, vi du `HD000001`.
- STT cho la so thu tu khach doi cat trong ca hien tai.
- Khi dung Render Web Service + Postgres, bill moi duoc luu vao bang `app_bills` rieng trong Postgres. Server tu cap So HD/STT bang transaction, nen nhieu may bam In bill cung luc van khong trung so.
- Neu mot may chua kip cap nhat bill cua may khac, server van giu bill da luu va khong de state cu ghi de mat hoa don.
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
- Quan Ly co the cai rieng dia chi/hotline/ten hien thi va kho giay in bill cho tung chi nhanh trong tab `Dau ca / Ket ca`.
- Ho tro kho giay may in nhiet `58mm` va `80mm`; khi in app tu set khung bill theo kho giay da chon.

## Chong da bill

- Bill da luu duoc khoa: khong co sua bill va khong co xoa bill.
- Nut `In bill` se luu hoa don vao he thong truoc roi moi in, khong con in hoa don nhap.
- Sau khi da in/luu, `Xoa dich vu` chi xoa bill dang soan moi, khong xoa duoc hoa don da luu.
- Tung bill co ma xac thuc va chuoi khoa hoa don. Man hinh Live se canh bao neu chuoi khoa bi dut hoac core bill bi can thiep.
- Bill in ra co ma xac thuc dang `PT-xxxxxx-xxxxxx`; Excel cung co cot ma xac thuc va khoa bill.
- Thu Ngan muon huy bill chi nhap ly do; khong can va khong duoc nhap ID/mat khau Quan Li.
- Quan Li xem duoc `Nhat ky chong da bill` trong tab `Dau ca / Ket ca`.
- Nhat ky ghi lai luu bill, huy bill, mo ca, ket ca va khoi phuc du lieu.
- Neu chay bang Render Web Service + Postgres, server se chan Thu Ngan neu co tinh xoa bill, sua bill cu, sua bang gia/nhan vien hoac huy bill truc tiep. Thu Ngan chi duoc tao yeu cau huy bill dang cho Quan Li/Admin duyet.

## Command Center Pro

- Man hinh Order co Live Command Center: doanh thu ca, STT tiep theo, do an toan bill, yeu cau huy dang cho duyet, khach quen va nhan vien noi bat.
- Khi nhap so dien thoai, app tu nhan dien khach quen: so lan ghe, tong chi va dich vu gan nhat.
- Canh bao thong minh hien khi co don huy cho duyet, ket tien lech, chuyen khoan can doi soat hoac chuoi khoa bill co van de.

## Thanh toan

- Ho tro `Tien mat`, `Chuyen khoan`, `The`, `Khac`.
- Doanh thu hop le tinh tat ca phuong thuc.
- Tien du kien trong ket chi tinh `Tien dau ca + bill Tien mat`.
- Bill chuyen khoan/the/khac van tinh doanh thu nhung khong lam tang tien mat trong ket.

## Ket ca

- Nut Ket ca chi chot so lieu va giu man hinh de kiem tra doanh thu, tien thuc te va chenh lech.
- Bam In ket ca & ve ca moi sau khi kiem tra xong. Luc do app in phieu va dua man hinh ca hien tai ve 0.
- Neu da chot ca truoc do, `In ket ca` se in lai ca vua ket gan nhat.
- Phieu ket ca in ro doanh thu theo tien mat, chuyen khoan, the va khac.

## Bao cao Excel

- Admin va Quan Li co nut `Xuat Excel 30 ngay` trong tab `Dau ca / Ket ca`.
- File `.xlsx` co phong cach PT Barbershop, ten thuong hieu va chi nhanh dang dang nhap.
- File gom 4 tab: `Tong hop 30 ngay`, `Chi tiet bill`, `Chia tho theo ngay`, `Tong chia tung tho`.
- Chi tiet bill co so HD, ma xac thuc, khoa bill, khach, tho cat/lam, dich vu, thanh toan, doanh thu, % chia, tien chia va trang thai huy.
- Khi Admin/Quan Li bam `Ket ca`, doanh thu ca moi ve 0 va Excel chi tiet cua ca vua chot duoc tao san. Bam `Tai Excel ket ca` de luu file vao may.
- Bill va nhat ky bao mat van duoc khoa tren he thong sau Ket ca de giu chong da bill.

## Bao mat ban Render

- Password trong Postgres duoc bam scrypt; API khong tra password ve trinh duyet va man hinh Tai khoan khong hien password.
- Dang nhap online dung phien HttpOnly ky so; dong bo bill khong gui lai mat khau.
- Tai khoan goc lay tu bien moi truong rieng tu cua Render, khong hard-code trong GitHub.
- Bill online co API rieng `/api/bills`, luu tung hoa don thanh ban ghi rieng trong Postgres va khoa So HD/STT bang transaction.
- Co gioi han dang nhap sai, gioi han request API, gioi han request ghi du lieu, khoa tam IP spam, Content Security Policy, cac security header trinh duyet va kiem soat quyen tren server.
- Neu bi DDoS lon, nen dat domain qua Cloudflare de co lop loc traffic phia truoc Render. Lop trong app giup chan spam/API abuse, con DDoS mang lon can firewall/CDN phia truoc.
- Ban mo truc tiep/offline van huu ich de du phong, nhung khong the an toan bang Render Web Service + Postgres vi khong co server de xac thuc va chong sua du lieu.
