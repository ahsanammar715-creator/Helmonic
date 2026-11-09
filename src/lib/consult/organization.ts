export type ConsultFolder = {
  id: string;
  parentFolderId: string | null;
  name: string;
  sortOrder: number;
};

export type ConsultConversationSummary = {
  id: string;
  folderId: string | null;
  title: string;
  updatedAt: string;
};

export type ConsultOrganizationResponse = {
  folders: ConsultFolder[];
  conversations: ConsultConversationSummary[];
};
