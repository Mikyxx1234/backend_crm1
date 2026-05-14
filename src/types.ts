export type CallPermission = 'pending' | 'temp' | 'permanent' | 'denied';

export type SenderType = 'user' | 'contact';

export interface Message {
  id: string;
  text: string;
  timestamp: string;
  sender: SenderType;
  status?: 'sent' | 'delivered' | 'read';
}

export interface FunnelStage {
  id: string;
  name: string;
  count: number;
  color: string;
  borderColor: string;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  stage: string;
  callPermission: CallPermission;
  messages: Message[];
  value?: string;
  responsible?: string;
  status?: 'OPEN' | 'CLOSED' | 'WON' | 'LOST';
  product?: string;
  createdAt: string;
  updatedAt: string;
  closingDate?: string;
  tags?: string[];
  avatar?: string;
}
