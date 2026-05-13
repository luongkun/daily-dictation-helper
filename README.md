# Trợ lí của Lương

Chrome/Edge extension giúp tự động làm bài luyện nghe trên [dailydictation.com](https://dailydictation.com).

Hỗ trợ cả hai dạng bài phổ biến:

- **Listen & Type** — tự động gõ đáp án lấy từ tab Full transcript (đáp án có sẵn ở DOM, độ chính xác **100%**).
- **Listen & Select** — tự động chọn đáp án: thử từng lựa chọn, nếu sai thì chọn lại đáp án còn lại rồi sang câu tiếp theo, lặp đến hết bài.

Không cần API key, không cần micro, không cần speech-to-text.

![icon](icons/icon128.png)

## Tính năng

- **Điền câu hiện tại**: gõ đáp án vào ô "Type what you hear..." (Listen & Type) hoặc chọn luôn đáp án đúng (Listen & Select).
- **Điền + Check**: gõ đáp án rồi bấm Check ngay; với bài Select thì tự thử lần lượt cho đến khi ra đáp án đúng.
- **Auto chạy hết bài**: tự động làm hết toàn bộ câu trong bài, có chỉnh delay giữa câu.
  - Với **Listen & Select**: extension click từng lựa chọn, bấm Check, nếu sai thì tự chuyển sang đáp án còn lại rồi bấm Next.
- **Chỉnh tốc độ gõ** (Listen & Type): gõ từng ký tự để trông tự nhiên (0–180 ms/ký tự) — mặc định 0ms (điền liền).
- **Phím tắt**:
  - `Ctrl+Shift+Enter` → Điền / chọn câu hiện tại
  - `Ctrl+Shift+A` → Bật / tắt Auto
  - `Ctrl+Shift+H` → Thu gọn / mở panel nổi
- **Panel nổi** ở góc dưới bên phải, có thể kéo, thu gọn hoặc tắt từ popup.
- **Anti-idle**: giữ cho bộ đếm phút học (“X minutes”) của trang **vẫn tăng khi treo máy**, không cần động vào chuột / bàn phím. Có **3 mức** chọn từ panel/popup:
  - **An toàn** (mặc định): 45s/lần, qua event của trang — giống người thật, không có rủi ro.
  - **Nhanh**: 15s/lần, POST trực tiếp — bỏ qua debounce 40s phía client. Treo 1h có thể được cộng ~3× phút (nếu server không cap).
  - **Turbo**: 5s/lần, POST trực tiếp — nhanh nhất, dễ bị server cap hoặc flag. Tự rớt về **An toàn** nếu server trả 403/429.
- **Lưu cài đặt** qua `chrome.storage.sync`.

## Cài đặt (Load unpacked)

1. Mở `chrome://extensions/` (hoặc `edge://extensions/`).
2. Bật **Developer mode** ở góc trên bên phải.
3. Bấm **Load unpacked** và chọn thư mục `daily-dictation-helper` (thư mục chứa file `manifest.json`).
4. Mở một bài trên dailydictation.com. Ví dụ:
   - Listen & Type: <https://dailydictation.com/exercises/numbers/phone-numbers.344/listen-and-type>
   - Listen & Select: <https://dailydictation.com/exercises/english-pronunciation/i-vs-ee-it-vs-eat.684/listen-and-select>
5. Panel "Trợ lí của Lương" xuất hiện ở góc dưới bên phải. Bấm **Điền + Check** hoặc **Auto chạy hết bài**.

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

### Listen & Type

- Mọi bài Listen & Type trên dailydictation.com đều render sẵn các đáp án vào DOM dưới class `.list-group-item` (cho tab Full transcript) — kể cả khi tab Full transcript đang ẩn.
- Extension chỉ cần:
  1. Đọc 30 phần tử `.list-group-item` để lấy mảng đáp án.
  2. Tìm số câu hiện tại từ nút có dạng `X / 30`.
  3. Set giá trị `#dictationInput` qua native setter để React nhận `input` event.
  4. Bấm `#btn-check`, đợi, rồi bấm `#btn-next` (hoặc `#btn-skip` nếu chưa hiện Next).

### Listen & Select

Bài này không có sẵn đáp án trong DOM trước khi bấm Check, nên extension dùng chiến thuật thử-và-sửa:

1. Tìm danh sách lựa chọn bằng selector `[title^="You can press"][title*="to select"]`.
2. Click lựa chọn đầu tiên, sau đó bấm nút **Check**.
3. Quan sát class của các lựa chọn:
   - `border-success` → đã chọn đúng.
   - `border-danger` → sai → chuyển sang lựa chọn tiếp theo (trang tự đánh dấu đúng sau khi click).
4. Khi xuất hiện nút **Next** → click để sang câu tiếp theo, đợi counter `X of Y` chuyển số rồi lặp lại.
5. Dừng khi đã ở câu cuối và đã bấm Next.

### Anti-idle (treo máy vẫn tính phút)

Trang dailydictation.com **không đếm phút học theo timer chạy nền** — nó chỉ cộng thời gian khi bạn tương tác (bấm Check / Next / Replay / Esc, hoặc audio bắt đầu phát). Cụ thể, các hành động đó dispatch một custom event `focusToInput` trên `window`, và một handler nội bộ của trang sẽ POST `/api/user/update-progress` để cộng thêm ~40 giây vào `time-spent`.

Extension hỗ trợ **3 chế độ** ở panel/popup:

| Mức | Chu kỳ | Cơ chế | Nhanh hơn gấp | Rủi ro |
|---|---|---|---|---|
| **An toàn** (mặc định) | 45s | `window.dispatchEvent(new Event("focusToInput"))` — y hệt khi bạn bấm Check/Next thật | 1× | Không |
| **Nhanh** | 15s | `fetch("/api/user/update-progress", {method:"POST"})` trực tiếp, bỏ qua debounce 40s ở client | ~3× | Thấp; nếu server cap thì không nhanh hơn nhưng không bị flag |
| **Turbo** | 5s | giống Nhanh nhưng tần suất cao hơn | ~8× | Trung bình; nếu server trả 403/429 thì extension **tự rớt về An toàn** và toast cảnh báo |

Anti-idle sẽ **tạm dừng** khi bạn đang chạy Auto (lúc đó trang đã tự ping rồi). Tất cả mode chỉ hoạt động khi đã đăng nhập (có phần tử `#time-spent` trong DOM). Mặc định **BẬT** ở chế độ **An toàn**.

## Tự build / dev

Không cần build step — đây là static extension Manifest V3. Sau khi sửa code:

- Bấm **Reload** ở thẻ extension trong `chrome://extensions`.
- Refresh trang dailydictation.com để load lại content script.

## Lưu ý sử dụng

Extension này dành cho mục đích cá nhân: tiết kiệm thời gian làm các bài đã thuộc, tự kiểm tra đáp án, hoặc xem nhanh transcript. Bạn vẫn nên tự nghe và gõ để cải thiện kỹ năng listening — nếu chỉ Auto chạy hết thì sẽ không học được gì 🙂.

## License

MIT
