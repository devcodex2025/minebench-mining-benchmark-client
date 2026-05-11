import React, { forwardRef } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ActivityIcon,
  AlertCircleIcon,
  AlertIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  AwardIcon,
  CalendarIcon,
  CancelIcon,
  ChartBarLineIcon,
  CheckmarkCircleIcon,
  CircleIcon,
  ClockIcon,
  CoinsIcon,
  CpuIcon,
  DashboardSpeedIcon,
  DatabaseIcon,
  DownloadIcon,
  FlameKindlingIcon,
  FolderOpenIcon,
  LegalHammerIcon,
  HardDriveIcon,
  HourglassIcon,
  InformationCircleIcon,
  LinkIcon,
  LoaderPinwheelIcon,
  LockIcon,
  LogoutIcon,
  MinusSignIcon,
  MonitorDotIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  SettingsIcon,
  ShieldIcon,
  SquareIcon,
  TerminalIcon,
  ThermometerIcon,
  TimerIcon,
  Delete02Icon,
  WalletIcon,
  ZapIcon,
} from '@hugeicons/core-free-icons';

export type IconProps = React.SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
};

export type LucideIcon = React.ForwardRefExoticComponent<
  Omit<IconProps, 'ref'> & React.RefAttributes<SVGSVGElement>
>;

const makeIcon = (icon: IconSvgElement): LucideIcon =>
  forwardRef<SVGSVGElement, IconProps>(
    ({ size = 24, strokeWidth = 1.8, color = 'currentColor', fill: _fill, ...props }, ref) => (
      <HugeiconsIcon
        ref={ref}
        icon={icon}
        size={size}
        color={color}
        strokeWidth={strokeWidth}
        {...props}
      />
    )
  );

export const Activity = makeIcon(ActivityIcon);
export const AlertCircle = makeIcon(AlertCircleIcon);
export const AlertTriangle = makeIcon(AlertIcon);
export const Award = makeIcon(AwardIcon);
export const BarChart3 = makeIcon(ChartBarLineIcon);
export const Calendar = makeIcon(CalendarIcon);
export const CheckCircle = makeIcon(CheckmarkCircleIcon);
export const Circle = makeIcon(CircleIcon);
export const Clock = makeIcon(ClockIcon);
export const Coins = makeIcon(CoinsIcon);
export const Cpu = makeIcon(CpuIcon);
export const Database = makeIcon(DatabaseIcon);
export const Download = makeIcon(DownloadIcon);
export const ExternalLink = makeIcon(LinkIcon);
export const Flame = makeIcon(FlameKindlingIcon);
export const FolderOpen = makeIcon(FolderOpenIcon);
export const Gauge = makeIcon(DashboardSpeedIcon);
export const Hammer = makeIcon(LegalHammerIcon);
export const HardDrive = makeIcon(HardDriveIcon);
export const Hourglass = makeIcon(HourglassIcon);
export const Info = makeIcon(InformationCircleIcon);
export const Loader = makeIcon(LoaderPinwheelIcon);
export const Lock = makeIcon(LockIcon);
export const LogOut = makeIcon(LogoutIcon);
export const Minus = makeIcon(MinusSignIcon);
export const Monitor = makeIcon(MonitorDotIcon);
export const PauseSolid = makeIcon(PauseIcon, 'solid');
export const SquareSolid = makeIcon(SquareIcon, 'solid');
export const Play = makeIcon(PlayIcon);
export const RefreshCw = makeIcon(RefreshIcon);
export const Settings = makeIcon(SettingsIcon);
export const Shield = makeIcon(ShieldIcon);
export const Square = makeIcon(SquareIcon);
export const Terminal = makeIcon(TerminalIcon);
export const Thermometer = makeIcon(ThermometerIcon);
export const Timer = makeIcon(TimerIcon);
export const Trash2 = makeIcon(Delete02Icon);
export const TrendingDown = makeIcon(ArrowDownIcon);
export const TrendingUp = makeIcon(ArrowUpIcon);
export const Wallet = makeIcon(WalletIcon);
export const X = makeIcon(CancelIcon);
export const Zap = makeIcon(ZapIcon);
