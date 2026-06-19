export type EmployeeRole = "owner" | "manager" | "pharmacist" | "technician" | "cashier" | "accountant" | "worker" | "developer"
export type SalaryType = "monthly" | "daily" | "hourly" | "none"
export type EmployeeStatus = "active" | "suspended" | "left"

export type Employee = {
  id: string
  name: string
  email?: string
  phone?: string
  role: EmployeeRole
  branchId?: string
  salary?: string
  salaryType?: SalaryType
  hireDate?: string
  address?: string
  notes?: string
  canLogin?: boolean
  loginEmail?: string
  status?: EmployeeStatus
  createdAt: number
  updatedAt: number
  createdBy?: string
}

export type EmployeeFormData = Omit<Employee, "id" | "createdAt" | "updatedAt" | "createdBy">
