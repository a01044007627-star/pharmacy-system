import { createUploadthing, type FileRouter } from "uploadthing/next"
import { UploadThingError } from "uploadthing/server"
import { getServerAuthScope } from "@/lib/auth/session"

const f = createUploadthing()

function uploadMetadata(scope: Awaited<ReturnType<typeof getServerAuthScope>>) {
  if (!scope.user) throw new UploadThingError("غير مسجل الدخول")

  return {
    userId: scope.user.id,
    email: scope.user.email ?? "",
    role: scope.role,
    pharmacyId: scope.activePharmacyId ?? "",
    branchId: scope.activeBranchId ?? "",
  }
}

function uploadResponse(metadata: ReturnType<typeof uploadMetadata>, file: { ufsUrl: string; key: string; name: string }) {
  return {
    uploadedBy: metadata.userId,
    email: metadata.email,
    role: metadata.role,
    pharmacyId: metadata.pharmacyId,
    branchId: metadata.branchId,
    url: file.ufsUrl,
    key: file.key,
    name: file.name,
  }
}

export const ourFileRouter = {
  profileImage: f({
    image: {
      maxFileSize: "4MB",
      maxFileCount: 1,
    },
  })
    .middleware(async () => uploadMetadata(await getServerAuthScope()))
    .onUploadComplete(async ({ metadata, file }) => uploadResponse(metadata, file)),

  itemImage: f({
    image: {
      maxFileSize: "8MB",
      maxFileCount: 1,
    },
  })
    .middleware(async () => {
      const metadata = uploadMetadata(await getServerAuthScope())
      if (!metadata.pharmacyId) throw new UploadThingError("اختر الصيدلية النشطة أولًا")
      return metadata
    })
    .onUploadComplete(async ({ metadata, file }) => uploadResponse(metadata, file)),
} satisfies FileRouter

export type OurFileRouter = typeof ourFileRouter
