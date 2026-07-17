// app/api/guardar-epic-id/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { supabase } from '@/lib/supabase'; // Asegúrate de usar el alias correcto

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { epicId } = await req.json();
    if (!epicId) {
      return NextResponse.json({ error: 'Falta el nombre de Epic' }, { status: 400 });
    }

    // 1. Mandar la orden al Servidor del Bot (Puerto 3001)
    const botResponse = await fetch('http://localhost:3001/api/bot/agregar-amigo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epicId }),
    });

    const botData = await botResponse.json();

    if (!botResponse.ok) {
      return NextResponse.json({ error: botData.error || 'El bot no encontró ese usuario' }, { status: 500 });
    }

    // 2. Guardar en Supabase para iniciar el contador de 48H
    const { error } = await supabase
      .from('user_profiles') // Ajusta el nombre de tu tabla
      .update({ 
        epic_id: epicId, 
        friend_request_sent_at: new Date().toISOString() 
      })
      .eq('email', session.user.email);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Solicitud enviada' });

  } catch (error: any) {
    console.error('Error en API guardar-epic-id:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}