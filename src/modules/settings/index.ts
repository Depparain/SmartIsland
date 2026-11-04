import React from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { WidgetPlugin } from "../../core/plugins/types";
import { SettingsWidget } from "./SettingsWidget";

export const settingsPlugin: WidgetPlugin = {
  id: "settings",
  nameKey: "tabs.settings",
  defaultLabel: "Settings",
  icon: SettingsIcon,
  defaultEnabled: true,
  order: 7,
  dimensions: {
    width: 460,
    height: 330,
  },
  component: SettingsWidget,
};

export { SettingsWidget };
