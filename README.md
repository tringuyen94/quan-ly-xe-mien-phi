## Tính năng

- **Tab sidebar:** Chủ xe | Số xe
  - **Chủ xe:** Tìm kiếm chủ xe (hỗ trợ tìm không dấu), xem danh sách xe theo từng chủ xe
  - **Số xe:** Tìm số xe trên toàn bảng tblXeMienPhi (không cần chọn chủ xe)
- Cập nhật hàng loạt ngày hết hạn theo tháng-năm (trả về đúng ngày cuối tháng)
- Cập nhật trạng thái xe miễn phí
- Hiển thị trạng thái kết nối SQL Server realtime

## Yêu cầu

- [Node.js](https://nodejs.org/) >= 18
- SQL Server đang chạy và có thể kết nối được từ máy chạy app

## Cài đặt

```bash
cd quan-ly-xe
npm install
```

## Cấu hình

Tạo file `.env` trong thư mục gốc của project:

```env
DB_SERVER=192.168.10.101
DB_PORT=1433
DB_DATABASE=dbChoThuDuc2017
DB_USER=your_user
DB_PASSWORD=your_password
```

## Chạy ứng dụng

**Development** (có auto-reload khi sửa file + DevTools):

```bash
npm run dev
```

**Production** (không DevTools, không auto-reload):

```bash
npm start
```

## Đóng gói (Build)

Tạo file cài đặt để phân phối cho người dùng:

```bash
# Windows (.exe installer + portable)
npm run build:win

# macOS (.dmg)
npm run build:mac

# Windows + macOS cùng lúc
npm run build
```

File output nằm trong thư mục `dist/`.

> **Lưu ý:** File `.env` sẽ được đóng gói vào `resources/` của bản build. Sau khi cài đặt, có thể chỉnh sửa file `.env` tại đường dẫn `resources/.env` bên trong thư mục cài đặt để đổi cấu hình database.

## Cấu trúc thư mục

```
quan-ly-xe/
├── main.js            # Electron main process (IPC, DB, window)
├── preload.js         # Context bridge (expose API cho renderer)
├── package.json       # Dependencies + build config
├── .env               # Cấu hình kết nối database
├── .gitignore
└── renderer/
    ├── index.html     # Giao diện chính
    ├── styles.css     # Stylesheet
    └── app.js         # Logic UI (sidebar tabs, owner/vehicle search, table, update)
```

## Công nghệ

- **Electron** — Framework desktop cross-platform
- **mssql** — Kết nối SQL Server
- **dotenv** — Đọc cấu hình từ file `.env`
- **electron-builder** — Đóng gói ứng dụng
- **electron-reload** — Hot reload khi phát triển
