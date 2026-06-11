# PT Barbershop POS

Bo web order/barbershop POS cho PT Barbershop.

## Tai khoan

- Quan Li: `9939` / `040426`
- Thu Ngan: `3122` / `152004`

## Deploy len Render

Nen chon 1 trong 2 cach:

### Cach 1: Blueprint

1. Day toan bo thu muc nay len GitHub.
2. Vao Render.
3. Chon `New +` -> `Blueprint`.
4. Chon repo GitHub vua tao.
5. Bam `Apply`.

Render se doc file `render.yaml` san co.

### Cach 2: Static Site

Neu Render khong dung Blueprint, chon `New +` -> `Static Site`, roi nhap:

- Name: `pt-barbershop-pos`
- Branch: `main`
- Root Directory: de trong
- Build Command: `echo "No build needed"`
- Publish Directory: `outputs`

Khong chon `New Web Service` cho bo nay.

## Sao luu du lieu

Du lieu luu tren trinh duyet cua tung may. Khi doi may:

1. Dang nhap Quan Li.
2. Vao `Dau ca / Ket ca`.
3. Bam `Tai file sao luu`.
4. Qua may moi, mo web va dang nhap Quan Li.
5. Vao `Dau ca / Ket ca`.
6. Bam `Nhap file sao luu`.

Neu may tinh da setup nhan vien/bang gia/dau ca ma dien thoai vao van nhu ban dau, do la vi du lieu static dang luu rieng theo tung thiet bi. Hay tai file sao luu tren may tinh roi nhap file sao luu tren dien thoai.

Neu muon nhieu may cung dung chung 1 du lieu theo thoi gian thuc thi can nang cap them backend/database.

## Hoa don

- Moi bill da luu co So HD, vi du `HD000001`.
- STT cho la so thu tu khach doi cat trong ca hien tai.
- Lich su bill co o tim So HD.
- Khi huy bill da luu phai nhap ly do.
- Thu Ngan khong xem duoc chi tiet huy bill; chi Quan Li moi xem duoc.
