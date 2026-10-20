SELECT TOP 2000 dateadd(hour, datediff(hour, 0, q_orders.created_at), 0) AS period, count(*) AS n 
FROM q_orders GROUP BY dateadd(hour, datediff(hour, 0, q_orders.created_at), 0) ORDER BY [period] ASC
