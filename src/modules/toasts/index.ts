import { Bell } from "lucide-react";
import { WidgetPlugin } from "../../core/plugins/types";
import { ToastsWidget } from "./ToastsWidget";

export const toastsPlugin: WidgetPlugin = {
  id: "notifications",
  nameKey: "tabs.notifications",
  defaultLabel: "Toasts",
  icon: Bell,
  defaultEnabled: true,
  order: 30,
  dimensions: {
    width: 460,
    height: 250,
  },
  component: ToastsWidget,
};
