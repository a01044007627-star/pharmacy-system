# Developer Control Plane

## الهدف

`/developer` هي مساحة إدارة المنصة، منفصلة عن دورة تشغيل الصيدليات. لا تعتمد على الفرع النشط في العرض، ولا تظهر لغير حسابات `developer_users` الفعالة.

## دورة الدخول

1. المطور يسجل من صفحة الدخول العادية.
2. الخادم يتحقق من هوية Supabase ومن سجل `developer_users`.
3. حساب المطور ينتقل إلى `/developer`، بينما باقي المستخدمين ينتقلون إلى `/dashboard`.
4. كل API تحت `/api/developer` يعيد `401` لغير المسجل و`403` لغير المطور.

## دورة العميل

الحالات المدعومة:

- `active`: التشغيل متاح.
- `suspended`: العمليات محجوبة مؤقتًا لغير المطور.
- `closed`: الحساب مغلق والعمليات محجوبة.

الخطط المدعومة:

- `trial`
- `starter`
- `professional`
- `enterprise`

يمكن للمطور ضبط انتهاء التجربة والاشتراك، وحدود الفروع والمستخدمين، وملاحظات داخلية. كل تعديل يُسجل في `developer_audit_events`.

## جلسة الدعم

فتح مساحة العميل لا ينتحل هوية مالك أو موظف. يتم إنشاء سجل في `developer_impersonation_sessions` باسم المطور وسبب الدعم، ثم فتح Dashboard في نطاق الصيدلية المحددة. يجب إنهاء الجلسة من سجل الجلسات بعد انتهاء الدعم.

## Feature Flags

تُدار من `developer_feature_flags`. حقل `conditions` يدعم:

```json
{
  "pharmacy_ids": ["uuid"],
  "exclude_pharmacy_ids": ["uuid"],
  "plans": ["professional", "enterprise"]
}
```

`GET /api/platform/config` يعيد القيم الفعالة للمستخدم الحالي والإصدار المنشور.

## الإصدارات

الإصدارات تستخدم SemVer، ويمكن تحديد إصدار نشط وإجباري وحد أدنى للتطبيق. نشر إصدار جديد يسجل حدث تدقيق مركزي.

## التشغيل

طبّق Migration:

```bash
npx supabase db push
```

يتطلب الأمر ربط المشروع أو توفير `SUPABASE_ACCESS_TOKEN` وبيانات قاعدة البيانات. لا تكفي مفاتيح Runtime لتنفيذ DDL.

## التحقق

```bash
npm test -- --runInBand
npm run typecheck
npx eslint src/app/developer src/app/api/developer src/features/developer src/lib/developer
```
