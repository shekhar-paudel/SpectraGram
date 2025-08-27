import {
  ShoppingBag,
  Forklift,
  Mail,
  MessageSquare,
  Calendar,
  Kanban,
  ReceiptText,
  Users,
  Lock,
  Fingerprint,
  SquareArrowUpRight,
  ChartBar,
  Banknote,
  Gauge,
  GraduationCap,
  School,
  Library,
  BookOpen,
  Presentation,
  CircleUser,
  DraftingCompass,
  ClipboardPen,
  Brain,
  FilePlus2,
  ListOrdered,
  CalendarCheck2,
  type LucideIcon,
} from "lucide-react";

export interface NavSubItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
}

export interface NavMainItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  subItems?: NavSubItem[];
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
  dataTour?: string;
}

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: "Model Report",
    items: [
      {
        title: "Onboard Model",
        url: "/model/onboard",
        icon: FilePlus2,
        comingSoon: false,
      },
      {
        title: "Model Profile",
        url: "/model/profile",
        icon: Brain,
        comingSoon: false,
      },
      {
        title: "Leaderboard",
        url: "/model/leaderboard",
        icon: ListOrdered,
        comingSoon: false,
      },
     {
        title: "Job Queue",
        url: "/worker/queue",
        icon: CalendarCheck2,
        comingSoon: false,
      },
     
    ],
  },
  
  {
    id: 2,
    label: "Documentation",
    items: [
       {
        title: "Data",
        url: "/documentation/data",
        icon: ClipboardPen,
        comingSoon: true,
      },
      {
        title: "Metric",
        url: "/documentation/metric",
        icon: DraftingCompass,
         comingSoon: true,
        // subItems: [
        //   { title: "Login v1", url: "/auth/v1/login", newTab: true },
        //   { title: "Login v2", url: "/auth/v2/login", newTab: true },
        //   { title: "Register v1", url: "/auth/v1/register", newTab: true },
        //   { title: "Register v2", url: "/auth/v2/register", newTab: true },
        // ],
      },
     
    ],
  },
];
