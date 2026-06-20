# إصلاح التثبيت وتحسين Clean Code

**التاريخ:** 20 يونيو 2026

## المشكلة

كان Vercel ينفذ:

```text
pnpm install
```

بينما المشروع يستخدم `package-lock.json` و`packageManager: npm@10.9.2`، مما يسبب تعارض مدير الحزم وفشل مرحلة التثبيت.

## الإصلاح

- تثبيت npm كمدير الحزم الوحيد.
- إضافة `installCommand: npm ci` داخل `vercel.json`.
- إضافة `buildCommand: npm run build` داخل `vercel.json`.
- تثبيت Node.js على `20.x` وnpm على `10.x`.
- إضافة `.nvmrc`.
- إضافة `preinstall` للتحقق من مدير الحزم ومنع lockfiles المختلطة.
- تحديث `package-lock.json` والتحقق منه بواسطة `npm ci`.

## تحسينات Clean Code وOOP

- `HttpClient`: طبقة موحدة لطلبات GET/POST/PUT/PATCH/DELETE.
- `ApiError`: خطأ typed للصلاحيات والحالة ورسائل الخادم.
- `SettingsEntityRepository`: Repository موحد لبيانات الإعدادات.
- `SettingsCrudService<T>`: Generic CRUD class قابلة لإعادة الاستخدام.
- تحويل خدمات الباركود والطابعات والفواتير والضرائب إلى typed services بدون `any`.
- تحويل إعدادات التطبيق إلى class تفصل Remote API وLocal Cache وOffline Queue.
- منع أخطاء الصلاحيات 401/403 من التسجيل كعمليات Offline.
- إضافة اختبارات للـHTTP client والـGeneric CRUD service.

## نتائج التحقق

- `npm ci`: ناجح، 811 حزمة.
- TypeScript: ناجح.
- ESLint: ناجح بدون أخطاء.
- Jest: 39/39 اختبار ناجح، 10 test suites.
- Production Build: ناجح.
- API routes: لا توجد مسارات مفقودة.
- Database tables/RPC references: لا توجد مراجع مفقودة.
