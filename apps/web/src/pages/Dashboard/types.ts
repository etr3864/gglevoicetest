export interface SuperAdminAgent {
  id: string;
  name: string;
  clientName: string | null;
  calls: number;
  minutes: number;
  totalCostIls: number;
  costPerMinIls: number;
  performance: {
    inboundCalls: number; inboundMinutes: number;
    outboundCalls: number; outboundMinutes: number;
    totalCalls: number; totalMinutes: number;
    avgDurationSec: number; appointmentsBooked: number;
    conversionRate: number; outboundNoAnswer: number;
    outboundAnswerRate: number;
  };
  costs: {
    geminiAudioCost: number;
    geminiTextCost: number;
    telnyxCallCost: number;
    telnyxRecordingCost: number;
    deepgramCost: number;
    totalCost: number;
    costPerMinIls: number;
    costPerCallIls: number;
  };
}

export interface SuperAdminSummary {
  totalCostIls: number;
  totalCalls: number;
  totalMinutes: number;
  avgCostPerMinIls: number;
}

export interface SuperAdminDashboardData {
  summary: SuperAdminSummary;
  agents: SuperAdminAgent[];
}
