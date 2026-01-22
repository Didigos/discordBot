import 'dotenv/config';
import express from 'express';
import {
  InteractionResponseType,
  InteractionType,
  InteractionResponseFlags,
  MessageComponentTypes,
  ButtonStyleTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { pool } from './db.js';

const app = express();
const PORT = process.env.PORT || 8080;

const CONNECT_MSG =
  'Abra seu FiveM, aperte **F8** e cole:\n' +
  '**connect liberaderoleplay.com.br**';

app.get('/', (req, res) => {
  res.status(200).send('Bot online ✅');
});

app.post(
  '/interactions',
  express.raw({ type: '*/*' }),
  (req, res, next) => {
    console.log(
      'POST /interactions',
      'sig?', !!req.headers['x-signature-ed25519']
    );
    next();
  },
  verifyKeyMiddleware(process.env.PUBLIC_KEY),
  async (req, res) => {
    const interaction = req.body;
    const { type, data, member, user, guild_id } = interaction;

    // 1) PING
    if (type === InteractionType.PING) {
      return res.send({ type: InteractionResponseType.PONG });
    }

    // 2) SLASH COMMANDS
    if (type === InteractionType.APPLICATION_COMMAND) {
      const { name } = data;

      if (name === 'setup-liberacao') {
        const perms = member?.permissions ?? '0';
        const isAdmin = (BigInt(perms) & BigInt(0x8)) === BigInt(0x8);

        if (!isAdmin) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '❌ Você não tem permissão.',
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `🔐 **Liberação de acesso**\nClique no botão para iniciar:`,
            components: [{
              type: MessageComponentTypes.ACTION_ROW,
              components: [{
                type: MessageComponentTypes.BUTTON,
                custom_id: 'liberar_acesso',
                style: ButtonStyleTypes.PRIMARY,
                label: 'Liberar Acesso',
              }],
            }],
          },
        });
      }

      if (name === 'didigos') {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '✅ Olá! Eu sou seu porteiro de liberação 😄' },
        });
      }
    }

    // 3) BOTÃO -> MODAL
    if (type === InteractionType.MESSAGE_COMPONENT) {
      if (data.custom_id === 'liberar_acesso') {
        return res.send({
          type: InteractionResponseType.MODAL,
          data: {
            custom_id: 'modal_liberar_acesso',
            title: 'Liberar Acesso',
            components: [
              {
                type: 1,
                components: [{
                  type: 4,
                  custom_id: 'nome_personagem',
                  label: 'Nome do personagem',
                  style: 1,
                  required: true,
                  max_length: 32,
                  placeholder: 'Ex: João Silva',
                }],
              },
              {
                type: 1,
                components: [{
                  type: 4,
                  custom_id: 'id_conta',
                  label: 'ID da conta',
                  style: 1,
                  required: true,
                  max_length: 12,
                  placeholder: 'Ex: 7',
                }],
              },
            ],
          },
        });
      }
    }

    // 4) MODAL SUBMIT (AQUI ESTÁ A CORREÇÃO)
    if (type === InteractionType.MODAL_SUBMIT) {
      if (data.custom_id === 'modal_liberar_acesso') {
        const inputs = {};
        data.components.forEach(row => {
          row.components.forEach(c => { inputs[c.custom_id] = c.value; });
        });

        let nomePersonagem = (inputs.nome_personagem?.trim() ?? '').replace(/\s+/g, ' ');
        let idConta = inputs.id_conta?.trim() ?? '';
        const discordId = member?.user?.id ?? user?.id;

        // Validações básicas
        if (nomePersonagem.length < 3 || !/^\d+$/.test(idConta)) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: '❌ Dados inválidos.', flags: InteractionResponseFlags.EPHEMERAL },
          });
        }

        try {
          // A) Verifica se ID existe
          const [rowsDb] = await pool.query('SELECT id, whitelist, axe_discord FROM accounts WHERE id = ? LIMIT 1', [Number(idConta)]);
          if (!rowsDb || rowsDb.length === 0) {
            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: { content: '❌ ID não encontrado.\n' + CONNECT_MSG, flags: InteractionResponseFlags.EPHEMERAL },
            });
          }

          const acc = rowsDb[0];
          // B) Verifica se já está vinculado a outro Discord
          if (acc.axe_discord && String(acc.axe_discord) !== String(discordId)) {
            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: { content: '❌ ID já vinculado a outro Discord.', flags: InteractionResponseFlags.EPHEMERAL },
            });
          }

          // C) Atualiza Banco de Dados
          const [updateResult] = await pool.query(
            `UPDATE accounts SET axe_discord = COALESCE(axe_discord, ?), whitelist = 1 
             WHERE id = ? AND (axe_discord IS NULL OR axe_discord = ?) AND whitelist = 0 LIMIT 1`,
            [String(discordId), Number(idConta), String(discordId)]
          );

          // D) Tenta mudar o apelido no Discord (antes de enviar a resposta final)
          try {
            const responseNick = await fetch(
              `https://discord.com/api/v10/guilds/${guild_id}/members/${discordId}`,
              {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bot ${process.env.DISCORD_TOKEN}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ nick: nomePersonagem }),
              }
            );

            if (!responseNick.ok) {
              const errorText = await responseNick.text();
              console.error('Erro na API do Discord ao mudar nick:', errorText);
            } else {
              console.log(`Sucesso: Apelido de ${discordId} alterado para ${nomePersonagem}`);
            }
          } catch (nickError) {
            console.error('Erro de rede ao mudar apelido:', nickError);
          }

          // E) Resposta final de sucesso
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `🎉 **Bem-vindo(a)!**\n\n✅ Whitelist liberada e apelido alterado para **${nomePersonagem}**.\n` +
                       `📌 Use: **connect liberaderoleplay.com.br** para entrar.`,
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });

        } catch (dbErr) {
          console.error('Erro DB:', dbErr);
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: '❌ Erro interno no servidor.', flags: InteractionResponseFlags.EPHEMERAL },
          });
        }
      }
    }
  }
);

app.listen(PORT, '0.0.0.0', () => {
  console.log('Listening on port', PORT);
});