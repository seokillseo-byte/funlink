# FunLink — Design Specification

Status: locked visual baseline. Reference screenshots are supplied by the product owner in the project conversation.

## DESIGN-01 — Public homepage

Reference image dimensions: 836 × 1881 px. Preserve the full-page composition and the following order:

1. Header: FunLink logo/tagline; Trang chủ; Tính năng; Bảng giá; Tài nguyên; Blog; Liên hệ; language selector; Đăng nhập; Đăng ký miễn phí.
2. Hero: benefit eyebrow; “FunLink — Smart Links for Growth”; supporting copy; primary registration CTA; demo CTA; trust assurances; dashboard illustration; growth/analytics floating visual.
3. Trusted-platform strip: Google, YouTube, Facebook, TikTok, Amazon, PayPal, VNPay and the existing “more” text.
4. Six feature cards: Rút gọn & Tùy chỉnh Link; Tên miền riêng; Theo dõi chi tiết; Chiến dịch Marketing; Mã QR thông minh; Website & CMS.
5. Blue statistics strip: 100K+, 10M+, 250%, 4.9/5 and feature-discovery CTA. These values are screenshot placeholders until verified; never present as real production metrics without evidence.
6. Audience section: SEOer; Affiliate Marketer; Doanh nghiệp; Nhà sáng tạo; Cửa hàng online; Dịch vụ & Agency; accompanying copy/illustrations.
7. Testimonial panel: quote, avatar, name, role and rating. Must use verified consented testimonial data before production; no fabricated identity or quote.
8. Pricing section: Free, Pro, Business, Enterprise; monthly/yearly selector; preserve the screenshot card hierarchy and CTA placement. Commercial amounts/limits require explicit confirmation before production activation.
9. FAQ: four questions shown in the reference, with expandable answers.
10. CTA banner: “Bắt đầu ngay hôm nay!” and registration action.
11. Footer: logo/description/social links; product/resources/contact columns; newsletter; legal links; copyright; back-to-top control.

## DESIGN-02 — CMS dashboard

Reference image dimensions: 1536 × 1024 px. Preserve the exact visible structure:

### Sidebar
My Workspace selector; Tổng quan; Liên kết của tôi; Tên miền tùy chỉnh; CMS Website group with Bài viết, Trang tĩnh, Danh mục, Giao diện, Cài đặt SEO, Cài đặt chung; Thống kê; Chiến dịch; QR Code; Thanh toán; Hồ sơ cá nhân; Trợ giúp; Đăng xuất; Pro usage/upgrade panel; support panel.

### Main area
Breadcrumb and title/subtitle; date-range selector; notifications/profile; create-article button; tabs Tổng quan, Bài viết, Trang tĩnh, Danh mục, SEO, Cài đặt; four KPI cards; article listing with search/category filter/status/views/SEO score/actions/pagination; SEO performance panel; website statistics chart with 7/30/90 day selector; quick SEO tools; article category distribution; recent activities.

## Immutable visual attributes
Preserve layout, geometry, section order, grid proportions, whitespace, colors, gradients, font hierarchy, sizes, weights, line heights, icons, image treatment, borders, radii, shadows, button dimensions and visual states. Do not modernize or simplify.

## Responsive behavior
Responsive adaptations are allowed only to preserve access and usability at smaller viewports without changing the approved desktop composition or removing features. Define exact breakpoint behavior in the relevant UI issue and compare at the reference viewport first.

## Unknowns requiring source verification
Exact font family, font files, HEX/RGB tokens, original illustration assets, image crops and precise CSS measurements cannot be reliably recovered from compressed screenshots alone. If source design assets are not available, extract measurable tokens from the original full-resolution screenshots and record confidence. Ask for approval before substituting assets/fonts or changing any visual token.

## Asset governance
The screenshot files themselves must be stored in the repository as immutable visual test fixtures before automated pixel comparison can be reliable. The chat-provided images are the authority; do not replace them with generated or stock images.
