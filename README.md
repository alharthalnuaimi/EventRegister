# أداة تسجيل الفعاليات — Event Register Tool

نموذج تسجيل حضور هاتفي أولاً، خفيف الوزن، بواجهة عربية/إنجليزية.

## الهيكل
```
event-register/
├── CONTRACT.md          ← العقد المشترك (المصدر الوحيد للحقيقة)
├── frontend/
│   ├── index.html       ← صفحة التسجيل الرئيسية
│   ├── style.css        ← التنسيقات (RTL + LTR)
│   ├── app.js           ← المنطق + Supabase مباشرة
│   └── display.html     ← شاشة QR للعرض الكبير
├── backend/             ← (Plan 2)
├── bot/                 ← (Plan 3)
└── db/migrations/       ← (Plan 4)
```

## التهيئة

### 1. Supabase
عدّل القيم في `frontend/config.js` (المفتاح العام فقط، ولا يوضع مفتاح الخدمة service key هنا أبداً):
```js
window.SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co';
window.SUPABASE_ANON = 'YOUR_ANON_KEY';
```

### 2. رقم واتساب
عدّل رابط واتساب في `index.html`:
```html
<a href="https://wa.me/964XXXXXXXXXX" ...>
```

### 3. التشغيل
```bash
# أي خادم محلي بسيط
npx serve frontend/
# أو
python -m http.server 8080 --directory frontend/
```

### 4. الفعالية
أضف معامل `?event=slug` للرابط:
```
https://your-domain.com/?event=my-event-2026
https://your-domain.com/display.html?event=my-event-2026
```

## الحقول
| الحقل | النوع | مطلوب |
|-------|-------|-------|
| الاسم الكامل | نص | ✅ |
| رقم الهاتف | رقم (E.164) | ✅ |
| البريد الإلكتروني | إيميل | ✅ |
| المسمى الوظيفي | نص | ✅ |
| مكان العمل / الجامعة | نص | ✅ |

## الألوان
- 🔵 كحلي: `#0B132B`
- 🔴 قرمزي: `#A51C30`
- 🟡 ذهبي: `#D4AF37`
