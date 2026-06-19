export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">أنت غير متصل بالإنترنت</h1>
      <p className="text-muted-foreground">
        التطبيق سيعمل تلقائياً عند الاتصال بالإنترنت
      </p>
    </div>
  )
}
