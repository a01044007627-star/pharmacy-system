# Pharmacy System

منظومة إدارة صيدليات متعددة الفروع مبنية بـ **Next.js 16 + TypeScript + Supabase**، وتدعم العمل Online/Offline والمزامنة والصلاحيات متعددة المستويات.

## المتطلبات

- Node.js `20.x`
- pnpm `10.x`
- قاعدة Supabase

> المشروع يستخدم **pnpm فقط**. لا تستخدم `npm install` أو Yarn داخل هذا المشروع.

## التشغيل المحلي

```bash
cp .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev
```

ثم افتح:

```text
http://localhost:3000
```

## فحوص الجودة

```bash
pnpm typecheck
pnpm test:ci
pnpm lint:ci
pnpm audit:project
pnpm build
```

أو شغّل الفحص المجمّع:

```bash
pnpm verify
```

## النشر على Vercel

المشروع يحدد أوامر النشر داخل `vercel.json`:

```json
{
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm build"
}
```

بالتالي لا يجب ضبط `npm install` يدويًا داخل إعدادات Vercel.

الإعدادات المطلوبة:

1. Framework Preset: `Next.js`
2. Node.js Version: `20.x`
3. Install Command: اتركه Default، لأن `vercel.json` يفرض `pnpm install --frozen-lockfile`
4. Build Command: اتركه Default، لأن `vercel.json` يفرض `pnpm build`
5. أضف متغيرات البيئة الموجودة في `.env.example`

## قاعدة البيانات

### قاعدة حالية تحتوي بيانات

خذ Backup كامل ثم نفّذ مرة واحدة:

```text
supabase/final-repair.sql
```

### قاعدة جديدة

```bash
pnpm db:build
```

ثم طبّق:

```text
supabase/deploy.sql
```

## تنظيم الكود

- `src/app`: الصفحات وAPI Routes
- `src/features`: الوحدات الوظيفية حسب المجال
- `src/lib/http`: عميل HTTP موحّد وأخطاء typed
- `src/lib/auth`: الصلاحيات وتحديد نطاق المستأجر
- `src/lib/sync`: Offline queue والمزامنة
- `src/features/settings/services`: Repositories وخدمات CRUD قابلة لإعادة الاستخدام
- `supabase`: migrations وملفات النشر والإصلاح

## ملاحظات أمنية

- صلاحية Developer مصدرها جدول `developer_users` فقط.
- لا يتم منح Developer من البريد أو `user_metadata` أثناء التشغيل.
- `SUPABASE_SERVICE_ROLE_KEY` يجب أن يبقى Server-side فقط.
- أخطاء الصلاحيات لا تتحول إلى Offline queue.
- لا ترفع `.env.local` أو مفاتيح الإنتاج إلى GitHub.

راجع `AUDIT_AND_DEPLOYMENT.md` قبل تطبيق SQL أو النشر على Production.
