import { PageAccess } from "@/components/auth/page-access"
import { UsersManagementView } from "@/features/users/components/users-management-view"

export default function EmployeesPage() {
  return (
    <PageAccess permission="users:read">
      <UsersManagementView variant="employees" />
    </PageAccess>
  )
}
