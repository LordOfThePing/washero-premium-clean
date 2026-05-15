export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id?: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      availability_exceptions: {
        Row: {
          created_at: string
          date: string
          id: string
          is_closed: boolean
          note: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          is_closed?: boolean
          note?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          is_closed?: boolean
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      availability_slots: {
        Row: {
          active: boolean
          capacity: number
          created_at: string
          date: string
          end_time: string
          id: string
          start_time: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          capacity?: number
          created_at?: string
          date: string
          end_time: string
          id?: string
          start_time: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          capacity?: number
          created_at?: string
          date?: string
          end_time?: string
          id?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      booking_requests: {
        Row: {
          address: string | null
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          is_test: boolean
          linked_booking_id: string | null
          missing_fields: Json | null
          neighborhood: string | null
          payment_method: string | null
          preferred_date: string | null
          preferred_time: string | null
          raw_payload: Json | null
          service_type: string | null
          source: string
          status: string
          updated_at: string
          vehicle_type: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          is_test?: boolean
          linked_booking_id?: string | null
          missing_fields?: Json | null
          neighborhood?: string | null
          payment_method?: string | null
          preferred_date?: string | null
          preferred_time?: string | null
          raw_payload?: Json | null
          service_type?: string | null
          source?: string
          status?: string
          updated_at?: string
          vehicle_type?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          is_test?: boolean
          linked_booking_id?: string | null
          missing_fields?: Json | null
          neighborhood?: string | null
          payment_method?: string | null
          preferred_date?: string | null
          preferred_time?: string | null
          raw_payload?: Json | null
          service_type?: string | null
          source?: string
          status?: string
          updated_at?: string
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_requests_linked_booking_id_fkey"
            columns: ["linked_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          address: string
          booking_source: string
          booking_status: string
          created_at: string
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string
          duration_minutes: number
          id: string
          neighborhood: string
          notes: string | null
          payment_method: string
          payment_status: string
          price: number
          scheduled_date: string
          scheduled_time: string
          service_id: string | null
          service_name: string
          updated_at: string
          vehicle_type: string
        }
        Insert: {
          address: string
          booking_source?: string
          booking_status?: string
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone: string
          duration_minutes: number
          id?: string
          neighborhood: string
          notes?: string | null
          payment_method?: string
          payment_status?: string
          price: number
          scheduled_date: string
          scheduled_time: string
          service_id?: string | null
          service_name: string
          updated_at?: string
          vehicle_type: string
        }
        Update: {
          address?: string
          booking_source?: string
          booking_status?: string
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          duration_minutes?: number
          id?: string
          neighborhood?: string
          notes?: string | null
          payment_method?: string
          payment_status?: string
          price?: number
          scheduled_date?: string
          scheduled_time?: string
          service_id?: string | null
          service_name?: string
          updated_at?: string
          vehicle_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      botmaker_conversations: {
        Row: {
          botmaker_conversation_id: string | null
          channel: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          id: string
          last_message: string | null
          last_message_at: string | null
          last_sender_type: string | null
          linked_booking_id: string | null
          linked_booking_request_id: string | null
          linked_customer_id: string | null
          raw_payload: Json | null
          updated_at: string
        }
        Insert: {
          botmaker_conversation_id?: string | null
          channel?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          last_message?: string | null
          last_message_at?: string | null
          last_sender_type?: string | null
          linked_booking_id?: string | null
          linked_booking_request_id?: string | null
          linked_customer_id?: string | null
          raw_payload?: Json | null
          updated_at?: string
        }
        Update: {
          botmaker_conversation_id?: string | null
          channel?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          last_message?: string | null
          last_message_at?: string | null
          last_sender_type?: string | null
          linked_booking_id?: string | null
          linked_booking_request_id?: string | null
          linked_customer_id?: string | null
          raw_payload?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "botmaker_conversations_linked_booking_id_fkey"
            columns: ["linked_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "botmaker_conversations_linked_booking_request_id_fkey"
            columns: ["linked_booking_request_id"]
            isOneToOne: false
            referencedRelation: "booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "botmaker_conversations_linked_customer_id_fkey"
            columns: ["linked_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      botmaker_events: {
        Row: {
          auth_valid: boolean
          channel: string | null
          conversation_id: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          event_type: string | null
          id: string
          message_text: string | null
          raw_payload: Json | null
          sender_type: string | null
        }
        Insert: {
          auth_valid?: boolean
          channel?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          event_type?: string | null
          id?: string
          message_text?: string | null
          raw_payload?: Json | null
          sender_type?: string | null
        }
        Update: {
          auth_valid?: boolean
          channel?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          event_type?: string | null
          id?: string
          message_text?: string | null
          raw_payload?: Json | null
          sender_type?: string | null
        }
        Relationships: []
      }
      botmaker_messages: {
        Row: {
          botmaker_message_id: string | null
          channel: string | null
          conversation_id: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          direction: string | null
          id: string
          message_text: string | null
          message_type: string | null
          raw_payload: Json | null
          sender_type: string | null
        }
        Insert: {
          botmaker_message_id?: string | null
          channel?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          direction?: string | null
          id?: string
          message_text?: string | null
          message_type?: string | null
          raw_payload?: Json | null
          sender_type?: string | null
        }
        Update: {
          botmaker_message_id?: string | null
          channel?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          direction?: string | null
          id?: string
          message_text?: string | null
          message_type?: string | null
          raw_payload?: Json | null
          sender_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "botmaker_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "botmaker_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_logs: {
        Row: {
          booking_id: string | null
          booking_request_id: string | null
          channel: string
          created_at: string
          customer_id: string | null
          direction: string
          id: string
          message_text: string | null
          provider: string
          raw_payload: Json | null
        }
        Insert: {
          booking_id?: string | null
          booking_request_id?: string | null
          channel: string
          created_at?: string
          customer_id?: string | null
          direction: string
          id?: string
          message_text?: string | null
          provider: string
          raw_payload?: Json | null
        }
        Update: {
          booking_id?: string | null
          booking_request_id?: string | null
          channel?: string
          created_at?: string
          customer_id?: string | null
          direction?: string
          id?: string
          message_text?: string | null
          provider?: string
          raw_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_logs_booking_request_id_fkey"
            columns: ["booking_request_id"]
            isOneToOne: false
            referencedRelation: "booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          neighborhood: string | null
          notes: string | null
          phone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          neighborhood?: string | null
          notes?: string | null
          phone: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          neighborhood?: string | null
          notes?: string | null
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      early_access_leads: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          neighborhood: string | null
          notes: string | null
          phone: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          neighborhood?: string | null
          notes?: string | null
          phone?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          neighborhood?: string | null
          notes?: string | null
          phone?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          booking_id: string | null
          created_at: string
          id: string
          invoice_number: string | null
          issued_at: string | null
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          id?: string
          invoice_number?: string | null
          issued_at?: string | null
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          id?: string
          invoice_number?: string | null
          issued_at?: string | null
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      kipper_leads: {
        Row: {
          booking_id: string | null
          created_at: string
          customer_id: string | null
          email: string | null
          full_name: string | null
          id: string
          notes: string | null
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          booking_id: string | null
          created_at: string
          id: string
          provider: string
          provider_payment_id: string | null
          raw_payload: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id?: string | null
          created_at?: string
          id?: string
          provider: string
          provider_payment_id?: string | null
          raw_payload?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string | null
          created_at?: string
          id?: string
          provider?: string
          provider_payment_id?: string | null
          raw_payload?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      service_areas: {
        Row: {
          active: boolean
          coverage_notes: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          coverage_notes?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          coverage_notes?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      services: {
        Row: {
          active: boolean
          base_price: number
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_price: number
          created_at?: string
          description?: string | null
          duration_minutes: number
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_price?: number
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      weekly_availability_rules: {
        Row: {
          allow_overlaps: boolean
          capacity: number
          created_at: string
          day_name: string
          day_of_week: number
          end_time: string
          id: string
          interval_minutes: number
          is_open: boolean
          slot_duration_minutes: number
          start_time: string
          updated_at: string
        }
        Insert: {
          allow_overlaps?: boolean
          capacity?: number
          created_at?: string
          day_name: string
          day_of_week: number
          end_time?: string
          id?: string
          interval_minutes?: number
          is_open?: boolean
          slot_duration_minutes?: number
          start_time?: string
          updated_at?: string
        }
        Update: {
          allow_overlaps?: boolean
          capacity?: number
          created_at?: string
          day_name?: string
          day_of_week?: number
          end_time?: string
          id?: string
          interval_minutes?: number
          is_open?: boolean
          slot_duration_minutes?: number
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_admin_profile: {
        Args: never
        Returns: {
          active: boolean
          email: string
          role: string
          user_id: string
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
