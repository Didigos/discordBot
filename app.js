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

// ✅ Rota de health só pra você testar no navegador (opcional, ajuda a confirmar que o site está vivo)
app.get('/', (req, res) => {
  res.status(200).send('Bot online ✅');
});

app.post(
  '/interactions',

  // ✅ Pega QUALQUER content-type (às vezes vem application/json; charset=utf-8)
  express.raw({ type: '*/*' }),

  // ✅ Log para confirmar se o Discord está chegando com headers de assinatura
  (req, res, next) => {
    console.log(
      'POST /interactions',
      'sig?',
      !!req.headers['x-signature-ed25519'],
      'ts?',
      !!req.headers['x-signature-timestamp']
    );
    next();
  },

  // ✅ Verifica assinatura com a PUBLIC_KEY
  verifyKeyMiddleware(process.env.PUBLIC_KEY),

  // ✅ Se passou no middleware, req.body já vem como objeto (não precisa JSON.parse manual)
  async (req, res) => {
    const interaction = req.body;
    const { type, data, member, user } = interaction;

    /* =======================
       PING (validação do Discord)
    ======================= */
    if (type === InteractionType.PING) {
      return res.send({ type: InteractionResponseType.PONG });
    }

    /* =======================
       SLASH COMMANDS
    ======================= */
    if (type === InteractionType.APPLICATION_COMMAND) {
      const { name } = data;

      // 🔒 /setup-liberacao (somente ADMIN)
      if (name === 'setup-liberacao') {
        const perms = member?.permissions ?? '0';
        const isAdmin = (BigInt(perms) & BigInt(0x8)) === BigInt(0x8);

        if (!isAdmin) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '❌ Você não tem permissão para usar este comando.',
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content:
              `🔐 **Liberação de acesso à cidade**\n\n` +
              `**Para você ser liberado na cidade é necessário que tenha tentando entrar pelo menos 1 vez no servidor para gerar sua ID.**\n\n` +
              `Clique no botão abaixo para iniciar sua liberação:\n\n` +
              `_não é uma whitelist, somente informe seu ID e Nome do personagem para liberar o acesso ao servidor._`,
            components: [
              {
                type: MessageComponentTypes.ACTION_ROW,
                components: [
                  {
                    type: MessageComponentTypes.BUTTON,
                    custom_id: 'liberar_acesso',
                    style: ButtonStyleTypes.PRIMARY,
                    label: 'Liberar Acesso',
                  },
                ],
              },
            ],
          },
        });
      }

      // /didigos
      if (name === 'didigos') {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '✅ Olá! Eu sou seu porteiro de liberação 😄' },
        });
      }

      return res.status(400).json({ error: `unknown command: ${name}` });
    }

    /* =======================
       BOTÃO → MODAL
    ======================= */
    if (type === InteractionType.MESSAGE_COMPONENT) {
      if (data.custom_id === 'liberar_acesso') {
        // Valores oficiais do Discord:
        // ACTION_ROW = 1, TEXT_INPUT = 4, style SHORT = 1
        return res.send({
          type: InteractionResponseType.MODAL,
          data: {
            custom_id: 'modal_liberar_acesso',
            title: 'Liberar Acesso',
            components: [
              {
                type: 1, // ACTION_ROW
                components: [
                  {
                    type: 4, // TEXT_INPUT
                    custom_id: 'nome_personagem',
                    label: 'Nome do personagem',
                    style: 1, // SHORT
                    required: true,
                    max_length: 32,
                    placeholder: 'Ex: João Silva',
                  },
                ],
              },
              {
                type: 1, // ACTION_ROW
                components: [
                  {
                    type: 4, // TEXT_INPUT
                    custom_id: 'id_conta',
                    label: 'ID da conta',
                    style: 1, // SHORT
                    required: true,
                    max_length: 12,
                    placeholder: 'Ex: 7',
                  },
                ],
              },
            ],
          },
        });
      }

      return res.status(400).json({ error: 'unknown component' });
    }

    /* =======================
       MODAL SUBMIT (VALIDAÇÃO + BANCO)
    ======================= */
    if (type === InteractionType.MODAL_SUBMIT) {
      if (data.custom_id === 'modal_liberar_acesso') {
        // Extrair inputs
        const inputs = {};
        const rows = Array.isArray(data.components) ? data.components : [];

        for (const row of rows) {
          for (const component of row.components ?? []) {
            inputs[component.custom_id] = component.value;
          }
        }

        let nomePersonagem = inputs.nome_personagem?.trim() ?? '';
        let idConta = inputs.id_conta?.trim() ?? '';

        // Normaliza espaços
        nomePersonagem = nomePersonagem.replace(/\s+/g, ' ');

        // Validação local
        const errors = [];

        if (nomePersonagem.length < 3 || nomePersonagem.length > 32) {
          errors.push('• O **nome do personagem** deve ter entre **3 e 32** caracteres.');
        }

        const nomeValido = /^[\p{L}\p{N} ._-]+$/u.test(nomePersonagem);
        if (!nomeValido) {
          errors.push(
            '• O **nome do personagem** possui caracteres inválidos. Use letras, números, espaço, . _ -'
          );
        }

        if (!/^\d+$/.test(idConta)) {
          errors.push('• O **ID da conta** deve conter **apenas números**.');
        } else if (idConta.length < 1 || idConta.length > 12) {
          errors.push('• O **ID da conta** deve ter até **12 dígitos**.');
        }

        if (errors.length) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `❌ **Corrija os campos abaixo:**\n${errors.join('\n')}`,
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        // Discord ID do usuário que enviou o modal
        const discordId = member?.user?.id ?? user?.id;
        if (!discordId) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '❌ Não consegui identificar seu Discord ID. Tente novamente no servidor.',
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }

        try {
          // 1) Verifica se o ID existe
          const [rowsDb] = await pool.query(
            'SELECT id, whitelist, axe_discord FROM accounts WHERE id = ? LIMIT 1',
            [Number(idConta)]
          );

          if (!rowsDb || rowsDb.length === 0) {
            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content:
                  '❌ **Você ainda não tentou conectar em nosso servidor para gerar uma ID.**\n\n' +
                  CONNECT_MSG,
                flags: InteractionResponseFlags.EPHEMERAL,
              },
            });
          }

          const acc = rowsDb[0];
          const axeDiscord = acc.axe_discord ? String(acc.axe_discord) : null;

          // 2) Se esse ID já está vinculado a OUTRO Discord, bloqueia
          if (axeDiscord && axeDiscord !== String(discordId)) {
            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content:
                  '❌ O ID informado está incorreto (já está vinculado a outro Discord). ' +
                  'Se tiver qualquer dúvida, abra um ticket.',
                flags: InteractionResponseFlags.EPHEMERAL,
              },
            });
          }

          // 0) Se esse Discord já está liberado em algum ID, bloqueia
          const [alreadyRows] = await pool.query(
            'SELECT id FROM accounts WHERE axe_discord = ? AND whitelist = 1 LIMIT 1',
            [String(discordId)]
          );

          if (alreadyRows && alreadyRows.length > 0) {
            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: '✅ Você já está liberado em nossa cidade. Qualquer dúvida, abra um ticket.',
                flags: InteractionResponseFlags.EPHEMERAL,
              },
            });
          }

          // 3) Se já está liberado e pertence ao mesmo Discord, só dá boas-vindas
          if (Number(acc.whitelist) === 1 && axeDiscord === String(discordId)) {
            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content:
                  '✅ Sua conta já está liberada!\n\n' +
                  'Para entrar no servidor:\n' +
                  '**connect liberaderoleplay.com.br**',
                flags: InteractionResponseFlags.EPHEMERAL,
              },
            });
          }

          // 4) Libera (vincula se NULL e seta whitelist=1)
          const [updateResult] = await pool.query(
            `
            UPDATE accounts
            SET
              axe_discord = COALESCE(axe_discord, ?),
              whitelist = 1
            WHERE id = ?
              AND (axe_discord IS NULL OR axe_discord = ?)
              AND whitelist = 0
            LIMIT 1
            `,
            [String(discordId), Number(idConta), String(discordId)]
          );

          if (!updateResult || updateResult.affectedRows !== 1) {
            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content:
                  '❌ Não consegui liberar agora (pode ter sido liberado por outra ação). ' +
                  'Tente novamente ou abra um ticket.',
                flags: InteractionResponseFlags.EPHEMERAL,
              },
            });
          }

          const responseNick = await fetch(`https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${discordId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bot ${process.env.DISCORD_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              nick: nomePersonagem
            }),
          });

          if (!responseNick.ok) {
            console.error('Erro ao atualizar apelido do Discord:', await responseNick.text());
          }

          const addRole = '1075839982771650715'
          const remRole = '1075840167084864060'


          const memberResponse = await fetch(`https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${discordId}`, {
            headers: {
              method: 'GET',
              'Authorization': `Bot ${process.env.DISCORD_TOKEN}`,
            },
          });

          console.log('memberResponse status:', memberResponse.status);
          const memberData = await memberResponse.json();
          console.log('memberData:', memberData);
          
          const hasAddRole = memberData.roles.includes(addRole);
          const hasRemRole = memberData.roles.includes(remRole);

          if (hasRemRole) {
            // Remover cargo de "Aguardando Liberação"
            const remRoleResponse = await fetch(
              `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${discordId}/roles/${remRole}`,
              {
                method: 'DELETE',
                headers: { 'Authorization': `Bot ${process.env.DISCORD_TOKEN}` }
              }
            )

            if (remRoleResponse.ok) {
              console.log(`Cargo ${remRole} removido do usuário ${discordId}`);
            } else {
              console.error('Erro ao remover cargo:', await remRoleResponse.text());
            }
          } else {
            console.log("O usuário já possui o cargo.");
          }

          if (!hasAddRole) {
            // 2. Se não tem o cargo, vamos adicionar
            const addRoleResponse = await fetch(
              `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${discordId}/roles/${addRole}`,
              {
                method: 'PUT', // PUT é usado para adicionar cargos no Discord
                headers: {
                  'Authorization': `Bot ${process.env.DISCORD_TOKEN}`,
                  'Content-Length': '0'
                }
              }
            );

            if (addRoleResponse.ok) {
              console.log(`Cargo ${addRole} atribuído ao usuário ${discordId}`);
            } else {
              console.error('Erro ao atribuir cargo:', await addRoleResponse.text());
            }
          } else {
            console.log("O usuário já possui o cargo.");
          }

          // 5) Boas-vindas
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content:
                `🎉 **Bem-vindo(a) à Liberdade Roleplay!**\n\n` +
                `✅ Sua whitelist foi liberada com sucesso.\n` +
                `• Personagem: **${nomePersonagem}**\n` +
                `• ID: **${idConta}**\n\n` +
                `📌 Para conectar:\n` +
                `1) Abra o FiveM\n` +
                `2) Aperte **F8**\n` +
                `3) Cole: **connect cfx.re/join/eqo8zm**\n\n` +
                `Nos vemos na cidade! 🚓🏙️`,
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        } catch (err) {
          console.error('Erro MySQL:', err);
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '❌ Erro ao consultar/atualizar o banco. Avise um staff.',
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }
      }

      return res.status(400).json({ error: 'unknown modal' });
    }

    return res.status(400).json({ error: 'unknown interaction type' });
  }
);



app.listen(PORT, '0.0.0.0', () => {
  console.log('Listening on port', PORT);
});
