// Plugin de exemplo: Echo
// Plugin simples que repete a mensagem

export const echoPlugin = {
  id: 'plugin.echo',
  
  async echo(data: { message: string }): Promise<{ success: boolean; echo?: string; error?: string }> {
    try {
      console.log('🔊 Echo plugin chamado com:', data.message);
      
      return {
        success: true,
        echo: `Echo: ${data.message}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

export default echoPlugin;
