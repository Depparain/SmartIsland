import { Shield } from "lucide-react";
import { WidgetPlugin } from "../../core/plugins/types";
import { VpnWidget } from "./VpnWidget";

export const vpnPlugin: WidgetPlugin = {
  id: "vpn",
  nameKey: "tabs.vpn",
  defaultLabel: "VPN",
  icon: Shield,
  defaultEnabled: true,
  order: 60,
  dimensions: {
    width: 460,
    height: 230,
  },
  component: VpnWidget,
};
