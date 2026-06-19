"use client"

import { useRef, useState } from "react"
import { Camera, ImageUp, Loader2, Trash2, UploadCloud } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { useUploadThing } from "@/lib/uploadthing/client"
import { cn } from "@/lib/utils"

type UploadResult = {
  serverData?: { url?: string | null }
  ufsUrl?: string | null
  url?: string | null
}

type ProfileImageUploaderProps = {
  name: string
  email: string
  avatarUrl: string
  disabled?: boolean
  onChange: (url: string) => void
  onRemove?: () => void
}

function initials(name: string, email: string) {
  const source = (name || email || "U").trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

export function ProfileImageUploader({ name, email, avatarUrl, disabled, onChange, onRemove }: ProfileImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [progress, setProgress] = useState(0)
  const { startUpload, isUploading } = useUploadThing("profileImage", {
    onUploadProgress: (value) => setProgress(value),
    onClientUploadComplete: (result) => {
      const file = (result?.[0] ?? null) as UploadResult | null
      const url = file?.serverData?.url ?? file?.ufsUrl ?? file?.url ?? ""
      if (!url) {
        toast.error("تم الرفع لكن لم يصل رابط الصورة")
        return
      }
      onChange(url)
      setProgress(100)
      toast.success("تم رفع الصورة الشخصية")
    },
    onUploadError: (error) => {
      setProgress(0)
      toast.error(error.message || "فشل رفع الصورة")
    },
  })

  async function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file || disabled || isUploading) return
    if (!file.type.startsWith("image/")) {
      toast.error("اختار صورة فقط")
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error("حجم الصورة لا يزيد عن 4MB")
      return
    }
    setProgress(3)
    await startUpload([file])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const busy = disabled || isUploading

  return (
    <div className="space-y-4 text-center" dir="rtl">
      <div
        className={cn(
          "relative mx-auto grid size-32 place-items-center rounded-[2rem] border border-brand/10 bg-white shadow-sm ring-8 ring-white/60",
          isUploading && "animate-pulse"
        )}
      >
        <Avatar className="size-28 rounded-[1.75rem]" size="lg">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={name || email} className="rounded-[1.75rem]" /> : null}
          <AvatarFallback className="rounded-[1.75rem] bg-brand-muted text-2xl font-black text-brand">
            {avatarUrl ? <Camera className="size-9" /> : initials(name, email)}
          </AvatarFallback>
        </Avatar>
        <span className="absolute -bottom-2 -left-2 grid size-10 place-items-center rounded-2xl bg-brand text-white shadow-lg ring-4 ring-white">
          {isUploading ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
        </span>
      </div>

      {isUploading ? <Progress value={progress} className="h-2 rounded-full" /> : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={busy}
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        <Button type="button" className="gap-2 rounded-xl" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          {isUploading ? <Loader2 className="size-4 animate-spin" /> : <ImageUp className="size-4" />}
          رفع صورة
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-2 rounded-xl border-slate-200"
          disabled={busy || !avatarUrl}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
          إزالة
        </Button>
      </div>

      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs font-bold leading-6 text-slate-500">
        <UploadCloud className="mx-auto mb-1 size-5 text-brand" />
        الصور تترفع عبر UploadThing ثم يتم حفظ الرابط في قاعدة البيانات مع دعم مسودة أوفلاين عند انقطاع الاتصال.
      </div>
    </div>
  )
}
