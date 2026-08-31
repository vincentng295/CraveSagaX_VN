# 🎮 CraveSagaX VN - Auto Translate Extension

Extension tự động việt hóa và tối ưu hiển thị cho webgame (Crave Saga X) chạy trên nền tảng Cocos2d-JS.

Crave Saga X là tựa game nhập vai chiến thuật theo lượt (turn-based) dành cho người lớn, lấy bối cảnh tại Vesteria - một thế giới song song giả tưởng nơi chỉ có nam giới sinh sống, chịu sự chi phối giữa các thiên thần và ác quỷ. Người chơi vào vai "Master" thực hiện hành trình cứu thế giới. Vesteria là một thế giới song song độc nhất chỉ có các chàng trai thuộc nhiều chủng tộc khác nhau sinh sống. Nơi đây chịu sự kiểm soát của phe thiên thần (muốn dẫn dắt nhân loại đến utopia) và phe ác quỷ (thỏa mãn tham vọng và sự đồi trụy). Nhân vật chính được tái sinh tại Vesteria bởi Thần Sáng tạo và Vua Thần nguyên thủy Arche để bắt đầu hành trình phiêu lưu và cứu rỗi.

<img alt="demo" src="https://github.com/user-attachments/assets/a9b8e1a9-3eea-42e0-bd67-ae69678a0d54" />

---

## 💖 Lý do ra đời

Dự án này được mình (**HuskyDG**) phát triển xuất phát từ **tình yêu đối với cốt truyện và cộng đồng game Crave Saga X**. Nhận thấy nhiều anh em người chơi Việt Nam gặp rào cản về ngôn ngữ (tiếng Anh / tiếng Nhật) làm giảm trải nghiệm thưởng thức lore game, mình làm tiện ích này để giúp mọi người tiếp cận nội dung game dễ dàng và trọn vẹn hơn.

---

## 🔓 Tính minh bạch & Mã nguồn mở

- **Hoàn toàn miễn phí & Phi lợi nhuận:** Dự án được phát triển vì cộng đồng, cam kết **không thu bất kỳ khoản phí nào** và **không thương mại hóa**.
- **Mã nguồn mở (Open Source):** Toàn bộ code của extension được mình mở công khai trên GitHub để anh em thoải mái kiểm tra, học hỏi hoặc cùng đóng góp phát triển.

---

## ⚠️ CẢNH BÁO AN TOÀN

> **LƯU Ý QUAN TRỌNG VỀ BẢO MẬT TÀI KHOẢN:**
> 
> Không sử dụng extension từ nguồn gốc không rõ nhằm tránh bị **đánh cắp thông tin đăng nhập, token session hoặc tài khoản game** của người dùng.
> 
> **Lời khuyên an toàn từ HuskyDG:**
> 1. **Chỉ tải tiện ích từ Repositories/Releases chính thức** tại GitHub này.
> 2. **Tuyệt đối KHÔNG sử dụng** các file `.crx`, `.zip` hoặc bản mod được phát tán qua các đường link trôi nổi, không rõ nguồn gốc.
> 3. Anh em biết về lập trình có thể thoải mái soi code trực tiếp ngay tại repo này để yên tâm sử dụng.

---

## 🚀 Hướng dẫn cài đặt

### 🖥️ Máy tính / Chrome (Windows, Mac, Linux)

1. **Tải mã nguồn:** Tải bản [Source code (zip)](https://github.com/vincentng295/CraveSagaX_VN/releases/latest) mới nhất về máy và giải nén.
2. **Mở trang quản lý Tiện ích:** Truy cập đường dẫn `chrome://extensions/` trên trình duyệt Chrome (hoặc Edge, Opera, Brave).
3. **Bật Chế độ dành cho nhà phát triển:** Gạt công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải sang trạng thái **BẬT (On)**.
4. **Tải tiện ích đã giải nén:** Nhấn vào nút **Load unpacked** (Tải tiện ích đã giải nén) ở góc trên bên trái, sau đó chọn thư mục chứa mã nguồn vừa giải nén.
5. **Ghim tiện ích:** Tìm tiện ích có tên *Crave Saga X Tiếng Việt* và ghim (Pin) lên thanh công cụ để dễ dàng thao tác khi chơi game.


---

### 📱 Điện thoại Android (Edge Canary)

Do các trình duyệt di động thông thường không hỗ trợ cài tiện ích chưa đóng gói, bạn có thể sử dụng các trình duyệt chuyên dụng như Edge Canary để chạy extension này trên Android.

#### 1. Tải [Trình duyệt Edge Canary](https://play.google.com/store/apps/details?id=com.microsoft.emmx.canary)
#### 2. **Tải file CRX:** Tải file [extension.crx](https://github.com/vincentng295/CraveSagaX_VN/releases/latest/download/extension.crx) trực tiếp về thiết bị Android.
#### 3. **Kích hoạt Chế độ nhà phát triển trong Edge Canary:**

<img alt="image" src="https://github.com/user-attachments/assets/ea576477-6c85-44ed-a0a2-73e68a7ca9b5" />

   * Mở Edge Canary → Vào **Cài đặt (Settings)** → **Về Microsoft Edge (About Microsoft Edge)**.
   * Nhấn liên tục **5–7 lần** vào logo phiên bản Edge (Edge Build Version) cho đến khi xuất hiện thông báo kích hoạt "Developer Options".

#### 4. **Cài đặt tiện ích:**
<img alt="image" src="https://github.com/user-attachments/assets/46d21f53-1ff5-469c-9a12-0ce15169dbf4" />

   * Quay lại menu Cài đặt chính → Vào **Developer Options**.
   * Chọn **Extension install by crx** → Nhấn **Choose .crx file** và chọn file `extension.crx` đã tải. 
   * Nhấn **OK** để hoàn tất cài đặt.

#### 5. **Quản lý extension**

<img alt="image" src="https://github.com/user-attachments/assets/89934dd7-40b6-438d-8fe0-4b1c45513b26" />



## Chơi Crave Saga X bản web

- Nutaku: <https://www.nutaku.net/games/crave-saga-x/play>
- Erolabs: <https://www.ero-labs.com/en/cloud_game.html?id=47&connect_type=1&connection_id=30>
- Johren: <https://www.johren.net/games/cravesaga-en/play/>
- FANZA GAMES (bản JP - クレイヴ・サーガX 神絆の導師): <https://play.games.dmm.co.jp/game/cravesagax>

---

## ☕ Ủng hộ dự án (Donation)

Extension hoàn toàn miễn phí, nhưng nếu bạn yêu thích công cụ này và muốn gửi chút "café" động viên mình tiếp tục duy trì, cập nhật tính năng mới thì có thể ủng hộ qua cổng VietQR bên dưới:

<img src="https://img.vietqr.io/image/BIDV-0332186295-compact2.png?amount=0&addInfo=CraveSagaX%20VN%20Donation&accountName=NGUYEN%20HOANG%20THE%20VI" alt="Mã QR Donation" width="300"/>

**Ngân hàng:** BIDV  
**Số tài khoản:** `0332186295`  
**Chủ tài khoản:** `NGUYEN HOANG THE VI`  
**Nội dung:** `CraveSagaX VN Donation`

> *Mọi đóng góp của anh em đều là nguồn động lực rất lớn đối với mình. Cảm ơn mọi người nhiều!* ❤️
