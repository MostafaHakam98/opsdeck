import {
  Activity,
  Box,
  ClipboardList,
  GitBranch,
  LayoutDashboard,
  Server,
  Settings,
  SlidersHorizontal,
  Timer,
  Zap,
} from "lucide-react";

export const hostPages = [
  {
    id: "overview",
    title: "Overview",
    icon: LayoutDashboard,
    group: "Monitor",
    scoped: true,
    description:
      "A live picture of capacity, workloads, and what needs attention.",
  },
  {
    id: "host",
    title: "Host & hardware",
    icon: Server,
    group: "Monitor",
    description:
      "CPU, memory, storage, network, GPU, services and processes on this node.",
  },
  {
    id: "docker",
    title: "Docker",
    icon: Box,
    group: "Monitor",
    scoped: true,
    description:
      "Containers, images and build cache in this node's Docker engine.",
  },
  {
    id: "gitlab",
    title: "Runner stack",
    icon: GitBranch,
    group: "CI runner",
    scoped: true,
    description:
      "Runner health, CI workers, toolchain images and cache volumes on this node.",
  },
  {
    id: "projects",
    title: "Projects & pipelines",
    icon: ClipboardList,
    group: "CI runner",
    scoped: true,
    description: "Repositories, pipelines and images observed on this runner.",
  },
  {
    id: "survey",
    title: "Survey & benchmarks",
    icon: Timer,
    group: "CI runner",
    scoped: true,
    description:
      "Capture live checkpoints and compare them with recorded benchmark runs.",
  },
  {
    id: "optimization",
    title: "Optimization",
    icon: Zap,
    group: "CI runner",
    description: "Measured opportunities and the next step for each resource.",
  },
  {
    id: "operations",
    title: "Operations",
    icon: SlidersHorizontal,
    group: "Manage",
    description:
      "Change runner capacity and manage local images. Every change is reviewed before it runs.",
  },
  {
    id: "activity",
    title: "Activity & audit",
    icon: Activity,
    group: "Manage",
    description: "Active threshold alerts and the history of every action.",
  },
  {
    id: "connections",
    title: "Connections",
    icon: Settings,
    group: "Manage",
    description:
      "Know what is connected, how fresh it is, and what to configure.",
  },
];
export const hostPageGroups = [...new Set(hostPages.map((p) => p.group))];
export function hostPageId(value?: string) {
  return hostPages.find((page) => page.id === value)?.id || "overview";
}
