declare module "lucide-react" {
  import type { FC, SVGProps } from "react"
  export type Icon = FC<SVGProps<SVGSVGElement>>
  export const AlertCircle: Icon
  export const AlertTriangle: Icon
  export const ArrowLeft: Icon
  export const ArrowRight: Icon
  export const ArrowUpDown: Icon
  export const ArrowDown: Icon
  export const ArrowUp: Icon
  export const Bell: Icon
  export const Calendar: Icon
  export const Check: Icon
  export const CheckCircle2: Icon
  export const CheckIcon: Icon
  export const ChevronDown: Icon
  export const ChevronDownIcon: Icon
  export const ChevronLeft: Icon
  export const ChevronLeftIcon: Icon
  export const ChevronRight: Icon
  export const ChevronRightIcon: Icon
  export const ChevronUp: Icon
  export const ChevronUpIcon: Icon
  export const ChevronsUpDown: Icon
  export const Copy: Icon
  export const CreditCard: Icon
  export const DollarSign: Icon
  export const Download: Icon
  export const Edit: Icon
  export const File: Icon
  export const FileText: Icon
  export const Filter: Icon
  export const Globe: Icon
  export const Image: Icon
  export const ImageUp: Icon
  export const Info: Icon
  export const Loader2: Icon
  export const LogIn: Icon
  export const LogOut: Icon
  export const Mail: Icon
  export const Menu: Icon
  export const Minus: Icon
  export const Moon: Icon
  export const MoreHorizontal: Icon
  export const MoreVertical: Icon
  export const Pencil: Icon
  export const Plus: Icon
  export const Printer: Icon
  export const RefreshCw: Icon
  export const RotateCcw: Icon
  export const Save: Icon
  export const Search: Icon
  export const Settings: Icon
  export const ShoppingCart: Icon
  export const SlidersHorizontal: Icon
  export const Sun: Icon
  export const Trash2: Icon
  export const Upload: Icon
  export const UploadCloud: Icon
  export const User: Icon
  export const Users: Icon
  export const X: Icon
  export const XIcon: Icon
  export const XCircle: Icon
  export const ZoomIn: Icon
  export const ZoomOut: Icon
  export const Package: Icon
  export const BarChart3: Icon
  export const TrendingUp: Icon
  export const TrendingDown: Icon
  export const Receipt: Icon
  export const Shield: Icon
  export const QrCode: Icon
  export const Camera: Icon
  export const Barcode: Icon
  export const Building: Icon
  export const Building2: Icon
  export const Phone: Icon
  export const Clock: Icon
  export const Store: Icon
  export const Warehouse: Icon
  export const Box: Icon
  export const Truck: Icon
  export const Percent: Icon
  export const Hash: Icon
  export const Tag: Icon
  export const Layers: Icon
  export const Activity: Icon
  export const Archive: Icon
  export const BookOpen: Icon
  export const Briefcase: Icon
  export const BriefcaseBusiness: Icon
  export const BadgeCheck: Icon
  export const Calculator: Icon
  export const CalendarDays: Icon
  export const CalendarClock: Icon
  export const Cloud: Icon
  export const CloudOff: Icon
  export const CircleHelp: Icon
  export const ClipboardList: Icon
  export const Coins: Icon
  export const Columns3: Icon
  export const Container: Icon
  export const Database: Icon
  export const ExternalLink: Icon
  export const Eye: Icon
  export const EyeOff: Icon
  export const FileSpreadsheet: Icon
  export const Fingerprint: Icon
  export const Gift: Icon
  export const GripHorizontal: Icon
  export const HandCoins: Icon
  export const Heart: Icon
  export const Home: Icon
  export const Hospital: Icon
  export const Inbox: Icon
  export const Key: Icon
  export const KeyRound: Icon
  export const Landmark: Icon
  export const LayoutDashboard: Icon
  export const Leaf: Icon
  export const Link: Icon
  export const List: Icon
  export const ListChecks: Icon
  export const ListFilter: Icon
  export const ListOrdered: Icon
  export const Loader: Icon
  export const Locate: Icon
  export const Lock: Icon
  export const MapPin: Icon
  export const Megaphone: Icon
  export const MessageSquare: Icon
  export const Monitor: Icon
  export const MoveHorizontal: Icon
  export const MoveVertical: Icon
  export const Newspaper: Icon
  export const Nut: Icon
  export const NutOff: Icon
  export const Pill: Icon
  export const ScrollText: Icon
  export const Send: Icon
  export const Share2: Icon
  export const ShieldAlert: Icon
  export const ShieldCheck: Icon
  export const ShoppingBag: Icon
  export const Shrink: Icon
  export const Signal: Icon
  export const Slash: Icon
  export const Smartphone: Icon
  export const Sparkles: Icon
  export const Square: Icon
  export const SquareCheck: Icon
  export const Star: Icon
  export const Stethoscope: Icon
  export const StopCircle: Icon
  export const Syringe: Icon
  export const Tablet: Icon
  export const Thermometer: Icon
  export const Timer: Icon
  export const Ungroup: Icon
  export const Unlink: Icon
  export const Unlock: Icon
  export const UserCircle: Icon
  export const UserCheck: Icon
  export const UserMinus: Icon
  export const UserPlus: Icon
  export const UserX: Icon
  export const Vial: Icon
  export const Video: Icon
  export const Volume2: Icon
  export const Wallet: Icon
  export const Wifi: Icon
  export const WifiOff: Icon
  export const Wrench: Icon
  export const Zap: Icon
  export const ZoomIn: Icon
  export const BellOff: Icon
  export const CheckCheck: Icon
  export const PanelRightClose: Icon
  export const PanelRightOpen: Icon
  export const Headphones: Icon
  export const Gauge: Icon
  export const ContactRound: Icon
  export const CheckSquare: Icon
  export type { Icon as LucideIcon }
}

declare module "sql.js" {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database
  }
  interface Database {
    run(sql: string, params?: unknown[]): Database
    exec(sql: string): QueryResult[]
    prepare(sql: string): Statement
    export(): Uint8Array
    close(): void
  }
  interface Statement {
    bind(params?: unknown[]): boolean
    step(): boolean
    getAsObject(): Record<string, unknown>
    free(): boolean
  }
  interface QueryResult {
    columns: string[]
    values: unknown[][]
  }
  interface SqlJsConfig {
    locateFile?: (file: string) => string
  }
  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>
}

declare module "next-themes" {
  import type { ReactNode } from "react"
  interface ThemeProviderProps {
    children: ReactNode
    attribute?: string
    defaultTheme?: string
    enableSystem?: boolean
    disableTransitionOnChange?: boolean
    forcedTheme?: string
    storageKey?: string
    themes?: string[]
    value?: Record<string, string>
  }
  export function ThemeProvider(props: ThemeProviderProps): JSX.Element
  export function useTheme(): {
    theme: string | undefined
    setTheme: (theme: string) => void
    themes: string[]
    systemTheme: string | undefined
    resolvedTheme: string | undefined
  }
}
