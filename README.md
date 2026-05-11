# Daily Dictation Helper

Chrome/Edge extension giúp tự động điền đáp án bài luyện nghe trên [dailydictation.com](https://dailydictation.com).

Extension đọc thẳng nội dung từ tab **Full transcript** ngay trong trang web (đáp án có sẵn ở DOM), nên độ chính xác là **100%** và **không cần API key, không cần micro, không cần speech-to-text**.

![icon](icons/icon128.png)

## Tính năng

- **Điền câu hiện tại**: gõ đáp án vào ô "Type what you hear..."
- **Điền + Check**: gõ đáp án rồi bấm Check ngay
- **Auto chạy hết bài**: tự động làm hết 30/30 câu, có chỉnh delay giữa câu
- **Dùng phím Esc của trang (mặc định bật)**: tận dụng luôn shortcut sẵn có của dailydictation.com (focus ô input → nhấn Esc → trang tự điền đáp án). Cách này nhanh nhất và không cần đọc Full transcript trước. Tắt checkbox này nếu muốn extension điền thủ công từ tab Full transcript.
- **Chỉnh tốc độ gõ**: gõ từng ký tự để trông tự nhiên (0–180 ms/ký tự) — mặc định 0ms (điền liền)
- **Phím tắt**:
  - `Ctrl+Shift+Enter` → Điền câu hiện tại
  - `Ctrl+Shift+A` → Bật / tắt Auto
  - `Ctrl+Shift+H` → Thu gọn / mở panel nổi
- **Panel nổi** ở góc dưới bên phải, có thể kéo, thu gọn hoặc tắt từ popup.
- **Lưu cài đặt** qua `chrome.storage.sync`.

## Cài đặt (Load unpacked)

1. Mở `chrome://extensions/` (hoặc `edge://extensions/`).
2. Bật **Developer mode** ở góc trên bên phải.
3. Bấm **Load unpacked** và chọn thư mục `daily-dictation-helper` (thư mục chứa file `manifest.json`).
4. Mở một bài bất kỳ kiểu *Listen & Type* trên dailydictation.com (ví dụ:
   <https://dailydictation.com/exercises/numbers/phone-numbers.344/listen-and-type>).
5. Panel "DD Helper" xuất hiện ở góc dưới bên phải. Bấm **Điền + Check** hoặc **Auto chạy hết bài**.

> Mẹo: Nếu mới mở bài ra mà panel báo "0 đáp án sẵn", hãy bấm sang tab **Full transcript** một lần rồi quay lại tab **Dictation**. Sau đó extension sẽ thấy đầy đủ 30 câu.

## Cấu trúc dự án

```
daily-dictation-helper/
├── manifest.json
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── content.js     # logic chính (đọc transcript + điền + auto)
    ├── content.css    # CSS cho panel nổi & toast
    ├── popup.html     # giao diện popup khi bấm icon extension
    ├── popup.css
    └── popup.js
```

## Cách hoạt động

- Mọi bài Listen & Type trên dailydictation.com đều render sẵn các đáp án vào DOM dưới class `.list-group-item` (cho tab Full transcript) — kể cả khi tab Full transcript đang ẩn.
- Extension chỉ cần:
  1. Đọc 30 phần tử `.list-group-item` để lấy mảng đáp án.
  2. Tìm số câu hiện tại từ nút có dạng `X / 30`.
  3. Set giá trị `#dictationInput` qua native setter để React nhận `input` event.
  4. Bấm `#btn-check`, đợi, rồi bấm `#btn-next` (hoặc `#btn-skip` nếu chưa hiện Next).

## Tự build / dev

Không cần build step — đây là static extension Manifest V3. Sau khi sửa code:

- Bấm **Reload** ở thẻ extension trong `chrome://extensions`.
- Refresh trang dailydictation.com để load lại content script.

## Lưu ý sử dụng

Extension này dành cho mục đích cá nhân: tiết kiệm thời gian làm các bài đã thuộc, tự kiểm tra đáp án, hoặc xem nhanh transcript. Bạn vẫn nên tự nghe và gõ để cải thiện kỹ năng listening — nếu chỉ Auto chạy hết thì sẽ không học được gì 🙂.

## License

MIT
