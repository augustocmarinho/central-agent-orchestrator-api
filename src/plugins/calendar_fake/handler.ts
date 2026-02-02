// Plugin de exemplo: Calendário Fake
// Este plugin demonstra como um plugin funciona no sistema

interface Appointment {
  id: string;
  title: string;
  datetime: string;
  attendee: string;
}

// Armazenamento em memória (apenas para demonstração)
const appointments: Appointment[] = [];

export const calendarFakePlugin = {
  id: 'plugin.calendar_fake',
  
  // Ação: Agendar
  async scheduleAppointment(data: {
    title: string;
    datetime: string;
    attendee: string;
  }): Promise<{ success: boolean; appointment?: Appointment; error?: string }> {
    try {
      const appointment: Appointment = {
        id: `appt_${Date.now()}`,
        title: data.title,
        datetime: data.datetime,
        attendee: data.attendee,
      };
      
      appointments.push(appointment);
      
      console.log('📅 Agendamento criado:', appointment);
      
      return {
        success: true,
        appointment,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
  
  // Ação: Listar agendamentos
  async listAppointments(data: {
    attendee?: string;
  }): Promise<{ success: boolean; appointments?: Appointment[]; error?: string }> {
    try {
      let results = appointments;
      
      if (data.attendee) {
        results = appointments.filter(a => a.attendee === data.attendee);
      }
      
      return {
        success: true,
        appointments: results,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
  
  // Ação: Cancelar agendamento
  async cancelAppointment(data: {
    appointmentId: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const index = appointments.findIndex(a => a.id === data.appointmentId);
      
      if (index === -1) {
        return {
          success: false,
          error: 'Agendamento não encontrado',
        };
      }
      
      appointments.splice(index, 1);
      
      console.log('❌ Agendamento cancelado:', data.appointmentId);
      
      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

export default calendarFakePlugin;
