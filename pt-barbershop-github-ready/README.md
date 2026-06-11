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

Neu muon nhieu may cung dung chung 1 du lieu theo thoi gian thuc thi can nang cap them backend/database.
