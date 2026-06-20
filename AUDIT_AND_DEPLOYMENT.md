# تقرير التقفيل الفني وخطوات التشغيل

**المشروع:** Pharmacy System  
**تاريخ المراجعة:** 20 يونيو 2026  
**نوع العمل:** مراجعة إنتاجية، فصل الصلاحيات، تقوية الأمان، إصلاح المزامنة، وتنظيم طبقات الكود وقاعدة البيانات.

## 1. نتيجة الفحص النهائي

تم تنفيذ الفحوص التالية على النسخة المسلّمة:

- TypeScript: ناجح بدون أخطاء.
- ESLint: ناجح بدون أخطاء.
- Jest: عدد 39 اختبارًا ناجحًا من 39، ضمن 10 مجموعات اختبار.
- Production Build: ناجح باستخدام Next.js.
- فحص ربط الواجهة بالـAPI والـDB:
  - 487 ملف TypeScript/TSX تمت مراجعته آليًا.
  - 91 API Route موجودة.
  - 97 استدعاء API تم التحقق من وجود مساراتها.
  - 69 جدولًا مستخدمًا من الواجهة والخدمات، وجميعها موجودة في SQL.
  - 30 RPC مستخدمة، وجميعها معرفة في SQL.
  - لا توجد مسارات API مفقودة أو جداول/RPC مفقودة وفق الفحص الساكن.

> الفحص تم على الكود والـSQL محليًا. لم يتم الاتصال بقاعدة Supabase الحية للعميل، لذلك يجب أخذ نسخة احتياطية وتشغيل ملف الإصلاح على قاعدة العميل ثم اختبار البيانات الفعلية قبل التسليم التشغيلي النهائي.


## 1.1 إصلاح Vercel وPackage Manager

تم توحيد مدير الحزم على **npm فقط** لمنع تعارض lockfiles وأوامر النشر:

- `package-lock.json` هو ملف القفل الوحيد.
- `packageManager` مضبوط على `npm@10.9.2`.
- `vercel.json` يفرض `npm ci` بدل أي إعداد قديم يشغّل `pnpm install`.
- `vercel.json` يفرض `npm run build`.
- تمت إضافة `.nvmrc` على Node.js 20.19.5.
- تمت إضافة فحص `preinstall` يمنع تشغيل المشروع بمدير حزم مختلف ويعرض رسالة واضحة.
- تم تثبيت `engines.node` على `20.x` و`engines.npm` على npm 10 لتطابق بيئة Vercel والحزم الحالية.

## 2. فصل الـDeveloper عن أصحاب الصيدليات

أصبح فصل الصلاحيات مبنيًا على مصدر واحد موثوق:

- جدول `developer_users` هو المصدر الوحيد لصلاحية المطوّر.
- البريد الإلكتروني أو `user_metadata` لا يمنحان صلاحية Developer أثناء التشغيل.
- صاحب الصيدلية يرى الصيدليات التي يملكها فقط.
- الموظف يرى الصيدليات والفروع المربوط بها فقط.
- الموظف المقيّد بفرع لا يستطيع الوصول لفرع آخر.
- المطوّر يرى المنصة كاملة دون إضافته كموظف أو عضو داخل أي صيدلية.
- قاعدة البيانات تمنع إضافة المطوّر في `pharmacy_profiles`.
- قاعدة البيانات تمنع تسجيل المطوّر كـ`owner_id` جديد لصيدلية.
- عند وجود ملكية قديمة لمطوّر ومعها عضو Owner فعلي، يتم نقل الملكية تلقائيًا للـOwner الفعلي أثناء تطبيق ملف الإصلاح.
- إنشاء حساب البريد الموجود في `DEVELOPER_BOOTSTRAP_EMAILS` لا ينشئ صيدلية أو فرعًا تلقائيًا.

الملفات الأساسية:

- `src/lib/auth/tenant-scope-resolver.ts`
- `src/lib/developer/bootstrap-authority.ts`
- `src/lib/developer/developer-provisioning-service.ts`
- `src/lib/auth/session.ts`
- `src/lib/auth/server-permissions.ts`

## 3. إصلاح Offline والمزامنة

تم تعديل التعامل مع الانقطاع والمزامنة كالتالي:

- يتم التحويل إلى Offline فقط عند أخطاء الشبكة الحقيقية.
- أخطاء RLS والصلاحيات وقيود قاعدة البيانات لا يتم إخفاؤها على أنها Offline.
- أي عملية مزامنة يجب أن تحتوي على `pharmacy_id` صالح، ومع الفرع عند الحاجة.
- تمييز الأخطاء الدائمة عن الأخطاء القابلة لإعادة المحاولة.
- منع إعادة محاولة أخطاء 409 وقيود البيانات بلا نهاية.
- دعم idempotency لعمليات الإنشاء لتقليل التكرار بعد عودة الاتصال.
- عمليات Update/Delete لا تعتبر ناجحة إلا عند رجوع سجل فعلي.
- بيانات المستخدم المحلية الخاصة يتم مسحها عند تسجيل الخروج.
- Service Worker لا يخزّن استجابات APIs المحمية داخل Cache Storage.

الملفات الأساسية:

- `src/lib/sync/offline-fallback-policy.ts`
- `src/lib/sync/data-layer.ts`
- `src/lib/sync/sync-manager.ts`
- `src/lib/db/local-db.ts`
- `public/sw.js`


## 3.1 تحسين Clean Code وOOP

تم تنفيذ Refactor فعلي في طبقات الاتصال والإعدادات:

- إضافة `HttpClient` موحّد لكل طلبات JSON.
- إضافة `ApiError` typed يحتوي على status وcode وخصائص retry/authorization.
- إضافة `SettingsEntityRepository` كطبقة Repository.
- إضافة `SettingsCrudService<T>` كـGeneric OOP service قابلة لإعادة الاستخدام.
- تحويل خدمات الطابعات والباركود والفواتير والضرائب إلى خدمات typed بدون `any`.
- تحويل `AppSettingsService` إلى class مع فصل واضح بين Remote API وLocal Cache وOffline Queue.
- منع أخطاء 401/403 وقيود البيانات من الدخول إلى Offline queue.
- إضافة اختبارات مستقلة لـHTTP client وGeneric CRUD service.

الملفات الأساسية:

- `src/lib/http/api-client.ts`
- `src/lib/http/api-error.ts`
- `src/features/settings/services/settings-entity-service.ts`
- `src/features/settings/services/settings-crud-service.ts`
- `src/features/settings/services/app-settings-service.ts`

## 4. قاعدة البيانات

تم إنشاء ملفين حسب حالة قاعدة البيانات:

### قاعدة موجودة وبها بيانات

شغّل الملف التالي **مرة واحدة فقط بعد أخذ Backup**:

```text
supabase/final-repair.sql
```

الملف يعالج:

- فصل المطوّر عن الصيدليات والفروع.
- تقوية دوال `is_developer` و`has_pharmacy_access` و`has_branch_access`.
- إصلاح سياسات وجدول `developer_users`.
- إصلاح إنشاء المستخدمين الجدد ومنع metadata من منح صلاحية Developer.
- إصلاح أعمدة `supplier_id` و`customer_id` و`patient_id` في القواعد التي توقفت migrations بها جزئيًا.
- إضافة مفاتيح idempotency لعمليات الشركاء وزيارات المرضى.
- إصلاح تقرير المبيعات اليومي وأسماء الأعمدة والـaliases.

### قاعدة جديدة فارغة

نفّذ:

```bash
npm run db:build
```

ثم طبّق:

```text
supabase/deploy.sql
```

تم تعديل منشئ ملف النشر حتى لا يكرر migrations القديمة الموجودة أصلًا داخل consolidated SQL.

## 5. متغيرات البيئة المطلوبة

انسخ `.env.example` إلى `.env.local` محليًا أو أضف القيم في Vercel:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=
DEVELOPER_BOOTSTRAP_EMAILS=
UPLOADTHING_TOKEN=
```

تعليمات مهمة:

- `SUPABASE_SERVICE_ROLE_KEY` يستخدم على السيرفر فقط، ولا يوضع أبدًا في متغير يبدأ بـ`NEXT_PUBLIC_`.
- `DEVELOPER_BOOTSTRAP_EMAILS` يقبل أكثر من بريد مفصولًا بفاصلة.
- بعد تسجيل أول Developer والتأكد من وجوده في `developer_users`، يمكن حذف بريد bootstrap من البيئة لزيادة الأمان؛ صلاحية التشغيل ستظل من الجدول.
- ملف `.env.local` غير موجود داخل ZIP المسلّم لحماية المفاتيح.

## 6. خطوات النشر الموصى بها

1. تثبيت Node.js 20.x وnpm 10.x.
2. فك المشروع وتشغيل:

```bash
npm ci
npm run verify
```

3. أخذ Backup كامل من Supabase.
4. لقاعدة موجودة: تشغيل `supabase/final-repair.sql`.
5. ضبط متغيرات البيئة في Vercel.
6. تشغيل build محلي:

```bash
npm run build
```

7. النشر على Vercel.
8. اختبار السيناريوهات التالية بحسابات فعلية:
   - Developer يرى جميع الصيدليات ولا يظهر كعضو بها.
   - Owner يرى صيدلياته فقط.
   - موظف فرع A لا يرى فرع B.
   - إنشاء بيع Offline ثم الاتصال ومراجعة سجل المزامنة.
   - تسجيل الخروج ثم الدخول بحساب مختلف والتأكد من عدم ظهور بيانات محلية سابقة.
   - المبيعات والمشتريات والمرتجعات والتقارير على بيانات العميل الفعلية.

## 7. فحص الحزم الأمنية

تم تحديث الحزم المتداخلة المتأثرة:

- `effect` إلى 3.21.4 عبر `overrides`.
- `postcss` إلى 8.5.15 عبر `overrides`.

انخفض فحص إنتاج npm من 7 تحذيرات إلى تحذير High واحد فقط خاص بحزمة `xlsx@0.18.5` في سجل npm العام، بدون Critical أو Moderate. النسخة الرسمية الأحدث من SheetJS متاحة من CDN الرسمي، لكن لم يتم تضمين ملف tarball الخارجي داخل النسخة حتى لا يصبح تثبيت المشروع معتمدًا على ملف لم يتم تنزيله والتحقق منه داخل بيئة المراجعة.

للتحديث من جهاز متصل بالإنترنت، اتبع توثيق SheetJS الرسمي واختبر استيراد/تصدير Excel بعد التحديث:

```bash
npm rm xlsx
npm i --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm run verify
npm run build
```

## 8. حدود التأكيد

هذه النسخة اجتازت اختبارات الكود والبناء والفحص الساكن. لا يمكن اعتبار البيانات الحية مقفلة نهائيًا دون:

- Backup لقاعدة العميل.
- تشغيل `final-repair.sql` على القاعدة الفعلية.
- مراجعة نتيجة SQL وأي بيانات قديمة غير متوافقة.
- اختبار تشغيل فعلي متعدد الحسابات والفروع على بيئة Staging قبل Production.
