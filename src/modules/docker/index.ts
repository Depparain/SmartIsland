import { Box } from "lucide-react";
import { WidgetPlugin } from "../../core/plugins/types";
import { DockerWidget } from "./DockerWidget";

export const dockerPlugin: WidgetPlugin = {
  id: "docker",
  nameKey: "tabs.docker",
  defaultLabel: "Docker",
  icon: Box,
  defaultEnabled: true,
  order: 50,
  dimensions: {
    width: 460,
    height: 270,
  },
  component: DockerWidget,
};
