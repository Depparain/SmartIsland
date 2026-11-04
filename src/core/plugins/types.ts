import React from "react";

export interface WidgetDimensions {
  width: number;
  height: number;
}

export interface WidgetPlugin {
  id: string;
  nameKey: string;
  defaultLabel: string;
  icon: React.FC<{ className?: string }>;
  defaultEnabled: boolean;
  order: number;
  dimensions: WidgetDimensions;
  component: React.ComponentType;
}
